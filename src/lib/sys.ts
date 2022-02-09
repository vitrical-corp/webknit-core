import fs from 'fs'
import os from 'os'
import {
  ID_PATH,
  PRIVATE_KEY_PATH,
  BACKUP_VERSION_PATH,
  UPDATE_VERSION_PATH,
  VERSION_PATH,
  APP_PACKAGE_PATH,
  APP_INDEX_PATH,
  API_URL_PATH,
} from './constants'
import { tokenize } from '@vitrical/webknit-lib/crypto'

export function getId(): Promise<string | null> {
  return fs.existsSync(ID_PATH) ? fs.promises.readFile(ID_PATH, 'utf8') : null
}

export function getPrivateKey(): Promise<string | null> {
  return fs.existsSync(PRIVATE_KEY_PATH) ? fs.promises.readFile(PRIVATE_KEY_PATH, 'utf8') : null
}

export function getAppPackage(): Promise<string | null> {
  return fs.existsSync(APP_PACKAGE_PATH) ? fs.promises.readFile(APP_PACKAGE_PATH, 'utf8') : null
}

export function validateAppFiles(): void {
  if (!fs.existsSync(APP_PACKAGE_PATH)) throw new Error('App package does not exist')
  if (!fs.existsSync(APP_INDEX_PATH)) throw new Error('App index does not exist')
}

export function getApiUrl(): Promise<string | null> {
  return fs.existsSync(API_URL_PATH) ? fs.promises.readFile(API_URL_PATH, 'utf8') : null
}

export async function getBackupVersion(): Promise<string | null> {
  try {
    if (!fs.existsSync(BACKUP_VERSION_PATH)) return null
    return fs.promises.readFile(BACKUP_VERSION_PATH, 'utf8')
  } catch (err) {
    throw err
  }
}

export async function getUpdateVersion(): Promise<string | null> {
  try {
    if (!fs.existsSync(UPDATE_VERSION_PATH)) return null
    return fs.promises.readFile(UPDATE_VERSION_PATH, 'utf8')
  } catch (err) {
    throw err
  }
}

export async function getAppVersion(): Promise<string> {
  try {
    if (!fs.existsSync(VERSION_PATH)) return '0.0.0'
    return fs.promises.readFile(VERSION_PATH, 'utf8')
  } catch (err) {
    throw err
  }
}

interface Network {
  address: string
  netmask: string
  family: string
  mac: string
  internal: boolean
  cidr: string
}

export function getNetworkInterface(): Network {
  const eth = os.networkInterfaces()

  let network: Network = {
    address: '',
    netmask: '',
    family: '',
    mac: '',
    internal: true,
    cidr: '',
  }

  if (eth['Wi-Fi']) {
    network = eth['Wi-Fi'].filter((connection) => connection.family === 'IPv4')[0]
  }
  if (eth['wifi']) {
    network = eth['wifi'].filter((connection) => connection.family === 'IPv4')[0]
  }
  if (eth['eth0']) {
    network = eth['eth0'].filter((connection) => connection.family === 'IPv4')[0]
  }
  if (eth['Ethernet']) {
    network = eth['Ethernet'].filter((connection) => connection.family === 'IPv4')[0]
  }
  if (eth['wlp1s0']) {
    network = eth['wlp1s0'].filter((connection) => connection.family === 'IPv4')[0]
  }

  return network
}

export function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function createAuthToken(
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
