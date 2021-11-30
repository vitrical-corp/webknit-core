import fs from 'fs'
import path from 'path'
import http, { Server } from 'http'
import express from 'express'

import { getNetworkInterface } from './lib/sys'

import { PRIVATE_KEY_PATH, API_URL_PATH, ID_PATH } from './lib/constants'

import { deviceRegister, setDeviceApiUrl } from 'webknit-device-api'

var serverLock: Server | null = null

export async function runRecoveryServer(onRecovered: Function) {
  try {
    if (serverLock) return
    const app = express()
    app.use(express.json())

    app.post('/api/register', async (req: any, res: any) => {
      try {
        const { code, url } = req.body
        const { mac } = getNetworkInterface()

        if (url) {
          setDeviceApiUrl(url)
        }

        const {
          msg,
          deviceId,
          privateKey,
          code: activationCode,
          errors,
          window,
        } = await deviceRegister({
          mac,
          code,
        })
        if (errors) {
          errors.forEach((err: Error) => console.log(err))
        }

        await Promise.all([
          fs.promises.writeFile(ID_PATH, deviceId, 'utf8'),
          fs.promises.writeFile(PRIVATE_KEY_PATH, privateKey, 'utf8'),
          fs.promises.writeFile(API_URL_PATH, url, 'utf8'),
        ])

        res.status(200).send({ err: false, msg, deviceId, window, code: activationCode })

        console.log('Successfully registered.')
        onRecovered()
      } catch (err) {
        console.log(err?.response?.data?.msg || err.message)
        console.log(err?.response?.data?.ip || err.stack)
        const msg = err?.response?.data?.msg || err.message
        return res.status(400).send({ err: true, msg })
      }
    })

    app.use('/', express.static(path.join(__dirname, './public')))

    serverLock = http.createServer(app).listen(80)
    console.log('Recovery server started on port 80')
  } catch (err) {
    throw err
  }
}

export function killRecoveryServer(): Promise<void> {
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
