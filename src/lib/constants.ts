import path from 'path'

const { SNAP_DATA, SNAP_COMMON } = process.env

export const STAT_PATH = path.join(SNAP_COMMON || path.join(__dirname, '../../'), './stats')
export const READY_STAT_PATH = path.join(STAT_PATH, './ready')
export const UPDATE_PATH = path.join(STAT_PATH, './update.zip')
export const BACKUP_PATH = path.join(STAT_PATH, './backup.zip')
export const ID_PATH = path.join(STAT_PATH, './id')
export const VERSION_PATH = path.join(STAT_PATH, './version')
export const UPDATE_VERSION_PATH = path.join(STAT_PATH, './update-version')
export const BACKUP_VERSION_PATH = path.join(STAT_PATH, './backup-version')
export const PRIVATE_KEY_PATH = path.join(STAT_PATH, './private')
export const API_URL_PATH = path.join(STAT_PATH, './api-url')
export const LOCATION_PATH = path.join(STAT_PATH, './location.json')

export const APP_PATH = path.join(SNAP_COMMON || path.join(__dirname, '../../'), './app')
export const APP_PACKAGE_PATH = path.join(APP_PATH, './package.json')
export const APP_INDEX_PATH = path.join(APP_PATH, './index.js')

export const STORE_PATH = path.join(SNAP_DATA || path.join(__dirname, '../../'), './store')
