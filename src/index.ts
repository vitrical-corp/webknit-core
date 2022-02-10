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
  createAuthToken,
} from './lib/sys'
import {
  downloadVersion,
  setDeviceApiUrl,
  deviceValidateId,
  deviceSetStatus,
  deviceClearStatus,
  deviceGetStartupInfo,
  deviceUpdateCrashes,
} from '@vitrical/webknit-device-api'
import { forceLogSync, log } from './lib/logger'
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

async function prepFolders(): Promise<void> {
  try {
    // Prep store folder
    const storeExist = fs.existsSync(STORE_PATH)
    if (!storeExist) {
      fs.mkdirSync(STORE_PATH)
    }

    // Prep stat folder
    if (!fs.existsSync(STAT_PATH)) {
      fs.mkdirSync(STAT_PATH)
    }
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
        log('App is up to date.')
        return false
      }
    }
    // Download the latest version of the update
    log(`Downloading update ${latest}`)
    const token = await createAuthToken(deviceId, privateKey, 15)
    await downloadVersion({ token, version: latest.toString(), output: UPDATE_PATH })
    // Write the version to the store path
    await fs.promises.writeFile(path.join(UPDATE_VERSION_PATH), latest.toString())
    log(`Done downloading ${latest}.`)
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
      log('Cannot revert the update because backup is missing. Skipping', true)
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

async function submitCrash(err: string) {
  try {
    const deviceId = await getId()
    const privateKey = await getPrivateKey()
    const version = await getAppVersion()
    const token = await createAuthToken(deviceId, privateKey, 20)
    await deviceUpdateCrashes({
      token,
      crash: {
        msg: err,
        timestamp: new Date().getTime(),
        version,
      },
    })
  } catch (err) {
    log('Error submitting crash report', true)
    log(err.stack, true)
    await forceLogSync()
  }
}

async function handleCommand(packet: any): Promise<void> {
  try {
    if (!packet.err) return
    if (typeof packet.err !== 'string') {
      log('Packet error in invalid format - expected string', true)
      return
    }
    log('Runtime error has been encountered. Restoring backup and creating crash log.', true)
    await submitCrash(packet.err)
    await killPM2()
    await revertUpdate()
    runPM2(handleCommand)
    await forceLogSync()
  } catch (err) {
    log(err.stack, true)
    await forceLogSync()
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
    log('Booting up and running procedures')
    await prepFolders()
    await setApiHeaders()

    const privateKey = await getPrivateKey()
    const deviceId = await getId()
    if (!privateKey || !deviceId) {
      log('Private key is not found. Running recovery server')
      return runRecoveryServer(handleOnRecovered)
    }

    log(`Device ID ${deviceId}`)

    try {
      const token = await createAuthToken(deviceId, privateKey, 8)
      log('Setting device status to booting up')
      await deviceSetStatus({ token, status: 'Booting up' })
    } catch (err) {
      log(err.stack, true)
    }

    try {
      log('Validating device ID')
      await deviceValidateId({ deviceId })
      log('Validated device ID')
    } catch (err) {
      log('Failed to validate device ID', true)
      log(err.stack, true)
      if (err?.response?.status === 410) {
        log('Device ID was determined invalid by server. Running recovery server', true)
        await forceLogSync()
        return runRecoveryServer(handleOnRecovered)
      }
    }

    try {
      let token = await createAuthToken(deviceId, privateKey, 8)
      const { location, latest } = await deviceGetStartupInfo({ token })
      if (location) {
        await writeLocationInfo(location)
      }
      if (latest) {
        log(`Latest update is ${latest}`)
        const updated = await checkUpdatesAndDownload(privateKey, deviceId, latest)
        if (updated) {
          token = await createAuthToken(deviceId, privateKey, 8)
          try {
            log('Setting device status to updating')
            await deviceSetStatus({ token, status: 'Updating' })
          } catch (err) {
            log(err.stack, true)
          }

          log(`Updated successfully. Killing app`)
          await killPM2()
          log(`Killed app. Extracting update`)
          await extractUpdate()
          log(`Completed extracting update.`)
        }
      }
    } catch (err) {
      log(err.stack, true)
    }

    try {
      log('Validating files')
      validateAppFiles()
      log('Successfully validated files')
    } catch (err) {
      log(err.stack, true)
      log('App failed validation. Reverting to backup', true)
      const backupVersion = await getBackupVersion()
      if (!backupVersion) {
        log('Backup file does not exist', true)
        throw new Error('Backup file does not exist and app is corrupt')
      }
      log(`Reverting to backup version ${backupVersion}`)
      await forceLogSync()
      await revertUpdate()
      await forceLogSync()
    }

    try {
      const token = await createAuthToken(deviceId, privateKey, 5)
      log('Clearing device status')
      await deviceClearStatus({ token })
    } catch (err) {
      log(err.stack, true)
    }

    log('Running app')
    await forceLogSync()
    await runPM2(handleCommand)
    await timeout(REFRESH_TIME)
    return main()
  } catch (err) {
    if (prevErr?.message !== err.message) {
      log(err.stack, true)
    }
    await timeout(2000)
    main(err)
  }
}

main()
