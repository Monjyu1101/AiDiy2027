// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import { CORE_BASE_URL } from '@/api/config'

const authStorage = window.desktopApi ? localStorage : sessionStorage

function createApiClient(baseURL: string): AxiosInstance {
  const client = axios.create({
    baseURL,
    headers: {
      'Content-Type': 'application/json',
    },
  })

  client.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    if (window.desktopApi?.avatarAlone) return config
    const token = authStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })

  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (!window.desktopApi?.avatarAlone && error?.response?.status === 401) {
        authStorage.removeItem('token')
        authStorage.removeItem('user')
        authStorage.removeItem('avatar_session_id')
        window.dispatchEvent(new Event('auth-expired'))
      }
      return Promise.reject(error)
    },
  )

  return client
}

const apiClient = createApiClient(CORE_BASE_URL)


export default apiClient
