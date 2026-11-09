// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE.
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Session, OnBeforeSendHeadersListenerDetails } from 'electron'

const unavailable = () => new Error('ローカル Core の内部認証を利用できません。Core の起動状態を確認してください。')
export function validateCoreBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw unavailable()
  return url.origin
}
export function configuredCoreBaseUrl(root: string): string {
  try {
    const settings = JSON.parse(readFileSync(join(root, '_config', 'AiDiy_key.json'), 'utf8').replace(/^\uFEFF/, ''))
    const port = Number(settings.PORT_CORE ?? 8091)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw unavailable()
    return `http://127.0.0.1:${port}`
  } catch { throw unavailable() }
}
// host/src/internal-auth.ts と同じ境界。host の配布物や renderer に秘密を渡さず毎回読み直す。
export function readInternalAuthorization(base: string, root: string): string {
  try {
    if (validateCoreBaseUrl(base) !== configuredCoreBaseUrl(root)) throw unavailable()
    let file = root
    for (const part of ['_AIDIY', 'backend_core', 'internal_auth.json']) {
      file = join(file, part)
      if (lstatSync(file).isSymbolicLink()) throw unavailable()
    }
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.size > 16384) throw unavailable()
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (value.token_type !== 'bearer' || typeof value.access_token !== 'string'
      || !/^[A-Za-z0-9._~-]{16,12000}$/.test(value.access_token)
      || typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at))
      || Date.parse(value.expires_at) <= Date.now()) throw unavailable()
    return `Bearer ${value.access_token}`
  } catch { throw unavailable() }
}

export function allowedCoreRequest(base: string, raw: string, method: string, resourceType: string): boolean {
  try {
    const url = new URL(raw)
    if (url.username || url.password || url.hash || url.search) return false
    const pathname = decodeURIComponent(url.pathname)
    if (resourceType === 'webSocket') return url.origin === base.replace(/^http:/, 'ws:') && pathname === '/core/ws/AIコア'
    if (url.origin !== base || resourceType !== 'xhr') return false
    return ['POST', 'OPTIONS'].includes(method) && [
      '/core/auth/現在利用者', '/core/AIコア/モデル情報/取得', '/core/AIコア/モデル情報/設定',
    ].includes(pathname)
  } catch { return false }
}

export function installAloneTransport(session: Session, base: string,
  trusted: (details: OnBeforeSendHeadersListenerDetails) => boolean, authorization: () => string): void {
  // フィルタを全 URL とし、別 origin への redirect に残った Authorization も必ず除く。
  const authenticated = new Set<number>()
  const origins = new Map<number, string>()
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    const headers = { ...details.requestHeaders }
    for (const name of Object.keys(headers)) if (name.toLowerCase() === 'authorization') delete headers[name]
    if (authenticated.has(details.id)) { callback({ cancel: true }); return }
    if (!allowedCoreRequest(base, details.url, details.method, details.resourceType) || !trusted(details)) {
      callback({ requestHeaders: headers }); return
    }
    try {
      if (details.method !== 'OPTIONS') headers.Authorization = authorization()
      authenticated.add(details.id)
      origins.set(details.id, details.frame?.url ? new URL(details.frame.url).origin : 'null')
      callback({ requestHeaders: headers })
    } catch { callback({ cancel: true }) }
  })
  session.webRequest.onHeadersReceived((details, callback) => {
    if (!authenticated.has(details.id)) { callback({}); return }
    // 認証済み要求の redirect は同一 origin を含め拒否。秘密の再送・転送を許さない。
    if (details.statusCode >= 300 && details.statusCode < 400) { callback({ cancel: true }); return }
    const headers = { ...details.responseHeaders }
    for (const name of Object.keys(headers)) if (name.toLowerCase().startsWith('access-control-')) delete headers[name]
    headers['Access-Control-Allow-Origin'] = [origins.get(details.id) || 'null']
    headers['Access-Control-Allow-Methods'] = ['POST, OPTIONS']
    headers['Access-Control-Allow-Headers'] = ['Content-Type']
    // Core の固定 CORS 一覧にない一時ポートでも、この登録済み要求だけを許可する。
    callback({ responseHeaders: headers, ...(details.method === 'OPTIONS' ? { statusLine: 'HTTP/1.1 204 No Content' } : {}) })
  })
  const clear = ({ id }: { id: number }) => { authenticated.delete(id); origins.delete(id) }
  session.webRequest.onCompleted(clear)
  session.webRequest.onErrorOccurred(clear)
}
