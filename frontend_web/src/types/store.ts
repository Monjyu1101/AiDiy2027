// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import type { C利用者 } from './entities'

/**
 * Auth Store State
 */
export interface AuthState {
  token: string
  user: C利用者 | null
  authChecked: boolean
}

/**
 * Login Result
 */
export interface LoginResult {
  success: boolean
  message?: string
}

