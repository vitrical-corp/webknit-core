#! /usr/bin/env node
import path from 'path'
import fs from 'fs'
import pm2 from 'pm2'
import {
  STORE_PATH,
  STAT_PATH,
  PRIVATE_KEY_PATH,
  APP_PATH,
  ID_PATH,
  API_URL_PATH,
  VERSION_PATH,
} from './lib/constants'

const EXEC_PATH = path.join(APP_PATH, './index.js')

const options = {
  name: 'app',
  script: EXEC_PATH,
  out_file: '/dev/null',
  error_file: '/dev/null',
  max_memory_restart: '512M',
  restart_delay: 2000,
  env: {
    STORE_PATH,
    STAT_PATH,
    PRIVATE_KEY_PATH,
    ID_PATH,
    API_URL_PATH,
    VERSION_PATH,
    NODE_ENV: 'production',
  },
}

var running = false

export function runPM2(onCommand: Function): Promise<void> {
  return new Promise((resolve, reject) => {
    if (running) return resolve()
    pm2.connect((err) => {
      if (err) {
        console.log(err)
        return reject(err)
      }

      pm2.start(options, (err, apps) => {
        if (err) {
          console.log(err)
          pm2.disconnect()
          return reject(err)
        }
        console.log(`Running app.`)
        running = true
        resolve()
      })

      pm2.launchBus((err, pm2Bus) => {
        if (err) {
          console.log(err)
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
      resolve()
    })
  })
}
