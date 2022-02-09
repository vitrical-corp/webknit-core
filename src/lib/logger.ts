import { deviceUpdateLogs } from '@vitrical/webknit-device-api'
import { createAuthToken, getPrivateKey, getId } from './sys'

interface Log {
  msg: string
  timestamp: number
  times: number
  err: boolean
}

let logHistory: Log[] = []
let maxHistory: number = 100
let lastSyncedHistory: number = new Date().getTime()

function addLog(msg: string, now: number, err?: boolean): boolean {
  let i = 0
  for (i; i < maxHistory; i++) {
    if (!logHistory[i]) break
    if (logHistory[i].msg === msg) {
      if (logHistory[i].times > 9999) return true
      logHistory[i].times++
      logHistory[i].timestamp = now
      return true
    }
  }
  logHistory.unshift({
    msg,
    timestamp: now,
    times: 1,
    err: err || false,
  })
  return false
}

export async function forceLogSync() {
  try {
    lastSyncedHistory = new Date().getTime()
    const privateKey = await getPrivateKey()
    const deviceId = await getId()
    const token = await createAuthToken(deviceId, privateKey, 20)
    await deviceUpdateLogs({ token, logs: logHistory })
    logHistory = []
    console.log('Synced log history with server')
  } catch (err) {
    console.log(err.stack)
  }
}

export function log(msg: string, err?: boolean) {
  const now = new Date().getTime()
  const found = addLog(msg, now, err)
  if (!found) {
    console.log(msg)
  }
}

export function forceLog(msg: string, err?: boolean) {
  console.log(msg)
  const now = new Date().getTime()
  addLog(msg, now, err)
}
