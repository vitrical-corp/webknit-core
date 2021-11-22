#! /usr/bin/env node
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import {
  STORE_PATH,
  STAT_PATH,
  PRIVATE_KEY_PATH,
  READY_STAT_PATH,
  APP_PATH,
  VERSION_PATH,
  UPDATE_PATH,
  ID_PATH,
  UPDATE_VERSION_PATH,
  BACKUP_VERSION_PATH,
  BACKUP_PATH,
  LOGS_PATH,
} from './lib/constants'
import {
  getUpdateVersion,
  getAppVersion,
  getBackupVersion,
  getId,
  getPrivateKey,
  timeout,
  getAppPackage,
  getApiUrl,
} from './lib/sys'
import { tokenize } from 'webknit-lib/crypto'
import { downloadVersion, getLatestVersion, setDeviceApiUrl } from 'webknit-device-api'
import { runRecoveryServer, killRecoveryServer } from './recover'
import { runPM2, killPM2 } from './pm2'

async function setApiHeaders() {
  try {
    const url = await getApiUrl()
    if (!url) return
    setDeviceApiUrl(url)
  } catch (err) {
    throw err
  }
}

async function createAuthToken(
  deviceId: string,
  privateKey: string,
  expiresIn: number
): Promise<string> {
  try {
    return tokenize(
      {
        deviceId,
      },
      privateKey,
      {
        expiresIn: `${expiresIn.toString()}s`,
      }
    )
  } catch (err) {
    throw err
  }
}

async function prepFolders(): Promise<void> {
  try {
    // Prep store folder
    const storeExist = fs.existsSync(STORE_PATH)
    if (!storeExist) {
      fs.mkdirSync(STORE_PATH)
    }

    // Prep logs folder
    const logsExist = fs.existsSync(LOGS_PATH)
    if (!logsExist) {
      fs.mkdirSync(LOGS_PATH)
    }

    // Prep stat folder
    if (!fs.existsSync(STAT_PATH)) {
      fs.mkdirSync(STAT_PATH)
    }
  } catch (err) {
    throw err
  }
}

async function checkUpdatesAndDownload(): Promise<boolean> {
  try {
    const privateKey = await getPrivateKey()
    const deviceId = await getId()
    const token = await createAuthToken(deviceId, privateKey, 10)
    // Write the assigned device ID
    await fs.promises.writeFile(path.join(ID_PATH), deviceId)
    // Get the latest version of the code
    const { latest } = await getLatestVersion({ token })
    if (fs.existsSync(APP_PATH)) {
      // If app exists, check if the version is the latest
      const version = await getAppVersion()
      if (latest.toString() === version) {
        console.log('App is up to date.')
        return false
      }
    }
    // Download the latest version of the update
    console.log(`Downloading update ${latest}...`)
    await downloadVersion({ token, version: latest.toString(), output: UPDATE_PATH })
    // Write the version to the store path
    await fs.promises.writeFile(path.join(UPDATE_VERSION_PATH), latest.toString())
    console.log(`Done downloading ${latest}.`)
    return true
  } catch (err) {
    throw err
  }
}

async function extractUpdate(): Promise<void> {
  try {
    if (fs.existsSync(READY_STAT_PATH)) {
      await fs.promises.rm(READY_STAT_PATH)
    }
    if (fs.existsSync(APP_PATH)) {
      // Backup the old files
      const backupZip = new AdmZip()
      backupZip.addLocalFolder(APP_PATH)
      backupZip.writeZip(BACKUP_PATH)
      // Make a backup version
      const version = await getAppVersion()
      await fs.promises.writeFile(path.join(BACKUP_VERSION_PATH), version)
      // Remove the old files
      await fs.promises.rmdir(APP_PATH, { recursive: true })
    }
    // Start the extraction process
    const zip = new AdmZip(UPDATE_PATH)
    await fs.promises.mkdir(APP_PATH)
    zip.extractAllTo(APP_PATH, true)
    await fs.promises.writeFile(READY_STAT_PATH, '', 'utf8')
    const version = await getUpdateVersion()
    await fs.promises.writeFile(path.join(VERSION_PATH), version)
  } catch (err) {
    throw err
  }
}

async function revertUpdate(): Promise<void> {
  try {
    if (!fs.existsSync(BACKUP_PATH)) {
      // We're kinda screwed :(
      console.error('Cannot revert the update because backup is missing. Skipping...')
      return
    }
    if (fs.existsSync(READY_STAT_PATH)) {
      await fs.promises.rm(READY_STAT_PATH)
    }
    if (fs.existsSync(APP_PATH)) {
      await fs.promises.rmdir(APP_PATH, { recursive: true })
    }
    // Start the extraction process
    const zip = new AdmZip(BACKUP_PATH)
    await fs.promises.mkdir(APP_PATH)
    zip.extractAllTo(APP_PATH, true)
    await fs.promises.writeFile(READY_STAT_PATH, '', 'utf8')
    const version = await getBackupVersion()
    await fs.promises.writeFile(path.join(VERSION_PATH), version)
  } catch (err) {
    throw err
  }
}

async function handleCommand(packet: any): Promise<void> {
  try {
    if (packet.err) {
      console.error('Runtime error has been encountered. Restoring backup...')
      console.error(packet.err)
      await killPM2()
      await revertUpdate()
      runPM2(handleCommand)
    }
  } catch (err) {
    console.error(err)
    process.exit(-1)
  }
}

async function handleOnRecovered() {
  try {
    await killRecoveryServer()
    return main()
  } catch (err) {
    throw err
  }
}

const REFRESH_TIME = 1000 * 60 * 60 * 4
var online = true

async function main(prevErr?: Error): Promise<void> {
  try {
    console.log('Running procedures...')
    await prepFolders()
    await setApiHeaders()

    const privateKey = await getPrivateKey()
    const id = await getId()
    if (!privateKey || !id) {
      console.log('Private key is not found. Running recovery server')
      return runRecoveryServer(handleOnRecovered)
    }
    console.log(`Device ID: ${id}`)

    if (online) {
      try {
        const updated = await checkUpdatesAndDownload()
        online = true
        if (updated) {
          console.log(`Updated successfully. Killing app...`)
          await killPM2()
          console.log(`Killed app. Extracting update...`)
          await extractUpdate()
          console.log(`Completed extracting update.`)
        }
      } catch (err) {
        console.error(err)
        if (!err.isAxiosError) throw err
        online = false
      }
    }

    const pkg = await getAppPackage()
    if (!pkg) {
      console.error('App does not exist. Reverting to backup...')
      const backupExists = await getBackupVersion()
      if (!backupExists) {
        throw new Error('Backup file does not exist')
      }
      await revertUpdate()
    }
    await runPM2(handleCommand)
    await timeout(REFRESH_TIME)
    return main()
  } catch (err) {
    if (prevErr?.message !== err.message) {
      console.error(err.message)
      console.error(err.stack)
    }
    if (err.isAxiosError) {
      online = false
    }
    await timeout(2000)
    main(err)
  }
}

main()
