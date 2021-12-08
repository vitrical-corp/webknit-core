#! /usr/bin/env node
import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import {
  STORE_PATH,
  STAT_PATH,
  READY_STAT_PATH,
  APP_PATH,
  VERSION_PATH,
  UPDATE_PATH,
  UPDATE_VERSION_PATH,
  BACKUP_VERSION_PATH,
  BACKUP_PATH,
  LOGS_PATH,
  LOG_PATH,
  ERR_PATH,
  LOCATION_PATH,
} from './lib/constants'
import {
  getUpdateVersion,
  getAppVersion,
  getBackupVersion,
  getId,
  getPrivateKey,
  timeout,
  getApiUrl,
  validateAppFiles,
} from './lib/sys'
import { tokenize } from 'webknit-lib/crypto'
import {
  downloadVersion,
  setDeviceApiUrl,
  deviceValidateId,
  deviceSetStatus,
  deviceClearStatus,
  deviceGetStartupInfo,
} from 'webknit-device-api'
import { runRecoveryServer, killRecoveryServer } from './recover'
import { runPM2, killPM2 } from './pm2'

function logError(err: any): void {
  console.log(err.stack)
  if (err.status) {
    console.log(`Status code ${err.status}`)
  }
}

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

async function clearLogs(): Promise<void> {
  try {
    const logsExist = fs.existsSync(LOGS_PATH)
    if (!logsExist) return null

    await Promise.all([
      fs.promises.writeFile(LOG_PATH, '', 'utf8'),
      fs.promises.writeFile(ERR_PATH, '', 'utf8'),
    ])
  } catch (err) {
    throw err
  }
}

async function writeLocationInfo(location: { [key: string]: any }): Promise<void> {
  try {
    await fs.promises.writeFile(LOCATION_PATH, JSON.stringify(location), 'utf8')
  } catch (err) {
    throw err
  }
}

async function checkUpdatesAndDownload(
  privateKey: string,
  deviceId: string,
  latest: number
): Promise<boolean> {
  try {
    if (fs.existsSync(APP_PATH)) {
      // If app exists, check if the version is the latest
      const version = await getAppVersion()
      if (latest.toString() === version) {
        console.log('App is up to date.')
        return false
      }
    }
    // Download the latest version of the update
    console.log(`Downloading update ${latest}`)
    const token = await createAuthToken(deviceId, privateKey, 15)
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
      console.log('Cannot revert the update because backup is missing. Skipping')
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
      console.log('Runtime error has been encountered. Restoring backup')
      console.log(packet.err)
      await killPM2()
      await revertUpdate()
      runPM2(handleCommand)
    }
  } catch (err) {
    console.log(err)
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

async function main(prevErr?: Error): Promise<void> {
  try {
    console.log('Running procedures')
    await prepFolders()
    await setApiHeaders()

    const privateKey = await getPrivateKey()
    const deviceId = await getId()
    if (!privateKey || !deviceId) {
      console.log('Private key is not found. Running recovery server')
      return runRecoveryServer(handleOnRecovered)
    }

    console.log(`Device ID ${deviceId}`)

    try {
      const token = await createAuthToken(deviceId, privateKey, 8)
      console.log('Setting device status to booting up')
      await deviceSetStatus({ token, status: 'Booting up' })
    } catch (err) {
      logError(err)
    }

    try {
      console.log('Validating device ID')
      await deviceValidateId({ deviceId })
      console.log('Validated device ID')
    } catch (err) {
      console.log('Failed to validate device ID')
      logError(err)
      if (err?.response?.status === 410) {
        console.log('Device ID was determined invalid by server. Running recovery server')
        return runRecoveryServer(handleOnRecovered)
      }
    }

    try {
      let token = await createAuthToken(deviceId, privateKey, 8)
      const { device, location, latest } = await deviceGetStartupInfo({ token })
      if (!device.keepLogs) {
        await clearLogs()
      }
      if (location) {
        await writeLocationInfo(location)
      }
      if (latest) {
        console.log(`Latest update is ${latest}`)
        const updated = await checkUpdatesAndDownload(privateKey, deviceId, latest)
        if (updated) {
          token = await createAuthToken(deviceId, privateKey, 8)
          try {
            console.log('Setting device status to updating')
            await deviceSetStatus({ token, status: 'Updating' })
          } catch (err) {
            logError(err)
          }

          console.log(`Updated successfully. Killing app`)
          await killPM2()
          console.log(`Killed app. Extracting update`)
          await extractUpdate()
          console.log(`Completed extracting update.`)
        }
      }
    } catch (err) {
      await clearLogs()
      logError(err)
    }

    try {
      console.log('Validating files')
      validateAppFiles()
      console.log('Successfully validated files')
    } catch (err) {
      logError(err)
      console.log('App failed validation. Reverting to backup')
      const backupVersion = await getBackupVersion()
      if (!backupVersion) {
        console.log('Backup file does not exist')
        throw new Error('Backup file does not exist and app is corrupt')
      }
      console.log(`Reverting to backup version ${backupVersion}`)
      await revertUpdate()
    }

    try {
      const token = await createAuthToken(deviceId, privateKey, 5)
      console.log('Clearing device status')
      await deviceClearStatus({ token })
    } catch (err) {
      logError(err)
    }

    console.log('Running app')
    await runPM2(handleCommand)
    await timeout(REFRESH_TIME)
    return main()
  } catch (err) {
    if (prevErr?.message !== err.message) {
      logError(err)
    }
    await timeout(2000)
    main(err)
  }
}

main()
