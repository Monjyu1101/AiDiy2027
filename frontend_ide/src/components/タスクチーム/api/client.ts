// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import axios from 'axios';
let key = '';
let internal = false;
const client = axios.create({ headers: { 'Content-Type': 'application/json' } });
export function configureClient(kind: string, base: string, internalAuth = false) {
  if (!['task', 'team'].includes(kind) || !base.startsWith('/') || base.startsWith('//')) throw Error('起動設定が不正です。');
  internal = internalAuth;
  key = `aidiy_${kind}_token`;
  client.defaults.baseURL = base;
}
export function token(value?: string) {
  if (!key || internal) return '';
  if (value !== undefined) { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key); }
  return sessionStorage.getItem(key) || '';
}
client.interceptors.request.use(config => {
  const value = token();
  if (value) config.headers.Authorization = `Bearer ${value}`;
  return config;
});
client.interceptors.response.use(response => response, error => {
  // 遅れて届いた旧セッションの401で、新しいログインを破棄しない。
  const current = token();
  if (error?.response?.status === 401 && (internal || current && error.config?.headers?.Authorization === `Bearer ${current}`)) { token(''); window.dispatchEvent(new Event('taskteam-auth-expired')); }
  return Promise.reject(error);
});
export const taskClient = client;
export const teamClient = client;
export default client;
