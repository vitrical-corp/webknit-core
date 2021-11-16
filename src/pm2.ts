#! /usr/bin/env node
import path from 'path'
import fs from 'fs'
import pm2 from 'pm2'
import http from 'http'
import express from 'express'
import {
  STORE_PATH,
  STAT_PATH,
  PRIVATE_KEY_PATH,
  SIGNATURE_PATH,
  APP_PATH,
  ID_PATH,
  API_URL_PATH,
  LOGS_PATH,
  VERSION_PATH,
} from './lib/constants'
import { timeout } from './lib/sys'
import { Server } from 'http'

const LOG_PATH = path.join(LOGS_PATH, './src.log')
const BACKUP_LOG_PATH = path.join(LOGS_PATH, './src.log.backup')
const ERR_PATH = path.join(LOGS_PATH, './src.err')
const BACKUP_ERR_PATH = path.join(LOGS_PATH, './src.err.backup')

const EXEC_PATH = path.join(APP_PATH, './index.js')

// 16MB
const LOG_CAP = 16 * 1024 * 1024

async function checkLogs() {
  try {
    if (!fs.existsSync(LOG_PATH)) return
    if (!fs.existsSync(ERR_PATH)) return
    const logStat = await fs.promises.stat(LOG_PATH)
    const errStat = await fs.promises.stat(ERR_PATH)
    if (logStat.size > LOG_CAP) {
      const contents = await fs.promises.readFile(LOG_PATH, 'utf8')
      await fs.promises.writeFile(BACKUP_LOG_PATH, contents)
      await fs.promises.writeFile(LOG_PATH, '')
    }
    if (errStat.size > LOG_CAP) {
      const contents = await fs.promises.readFile(ERR_PATH, 'utf8')
      await fs.promises.writeFile(BACKUP_ERR_PATH, contents)
      await fs.promises.writeFile(ERR_PATH, '')
    }
  } catch (err) {
    console.error(err)
  } finally {
    await timeout(1000 * 30)
    checkLogs()
  }
}
checkLogs()

var serverLock: Server | null = null

export async function runLogServer(): Promise<void> {
  try {
    if (serverLock) return
    const app = express()

    app.get('/', (req, res) => {
      const logContents = fs.readFileSync(LOG_PATH, 'utf8')
      const errContents = fs.readFileSync(ERR_PATH, 'utf8')
      return res.status(200).send(
        `<br><div>SYS Logs:</div><br>${logContents
          .split('\n')
          .map((line) => `<div>${line}</div>`)
          .reduce((a, b) => a + b)}<br><div>ERR Logs:</div><br>${errContents
          .split('\n')
          .map((line) => `<div>${line}</div>`)
          .reduce((a, b) => a + b)}`
      )
    })

    serverLock = http.createServer(app).listen(2000)
    console.log('Log server started on port 2000')
  } catch (err) {
    throw err
  }
}

export function killLogServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (!serverLock) return
      serverLock.close((err) => {
        if (err) return reject(err)
        resolve()
      })
      serverLock = null
    } catch (err) {
      throw err
    }
  })
}

const options = {
  name: 'app',
  script: EXEC_PATH,
  log_date_format: 'YYYY-MM-DD HH:mm Z',
  out_file: LOG_PATH,
  error_file: ERR_PATH,
  combine_logs: true,
  max_memory_restart: '512M',
  max_restarts: 10,
  restart_delay: 2000,
  env: {
    STORE_PATH,
    STAT_PATH,
    PRIVATE_KEY_PATH,
    SIGNATURE_PATH,
    ID_PATH,
    API_URL_PATH,
    VERSION_PATH,
    LOGS_PATH,
    LOG_PATH,
    BACKUP_LOG_PATH,
    ERR_PATH,
    BACKUP_ERR_PATH,
    NODE_ENV: 'production',
  },
}

var running = false

export function runPM2(onCommand: Function): Promise<void> {
  return new Promise((resolve, reject) => {
    if (running) return resolve()
    pm2.connect((err) => {
      if (err) {
        console.error(err)
        return reject(err)
      }

      pm2.start(options, (err, apps) => {
        if (err) {
          console.error(err)
          pm2.disconnect()
          return reject(err)
        }
        console.log(`Running app.`)
        running = true
        runLogServer()
        resolve()
      })

      pm2.launchBus((err, pm2Bus) => {
        if (err) {
          console.error(err)
          onCommand({ err })
          return
        }
        pm2Bus.on('process:msg', (packet: any) => {
          onCommand(packet)
        })
      })
    })

    process.on('SIGINT', () => {
      pm2.killDaemon(() => {
        process.exit(-1)
      })
    })

    process.on('exit', () => {
      pm2.killDaemon(() => {
        process.exit(-1)
      })
    })
  })
}

export function killPM2(): Promise<void> {
  return new Promise((resolve) => {
    if (!running) return resolve()
    pm2.killDaemon(() => {
      console.log(`Stopped app.`)
      running = false
      killLogServer()
      resolve()
    })
  })
}
