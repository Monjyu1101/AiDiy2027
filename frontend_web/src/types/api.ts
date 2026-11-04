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
 * 認証関連
 */
export interface LoginRequest {
  利用者ID: string
  パスワード: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
}

export interface CurrentUserResponse extends C利用者 {
  権限名?: string
}

/**
 * C権限 API
 */
export interface C権限GetRequest {
  権限ID: string
}

export interface C権限CreateRequest {
  権限ID: string
  権限名: string
  権限備考?: string
  有効?: boolean
}

export interface C権限UpdateRequest {
  権限ID: string
  権限名?: string
  権限備考?: string
  有効?: boolean
}

export interface C権限DeleteRequest {
  権限ID: string
}

/**
 * C利用者 API
 */
export interface C利用者GetRequest {
  利用者ID: string
}

export interface C利用者CreateRequest {
  利用者ID: string
  利用者名: string
  パスワード: string
  権限ID: string
  利用者備考?: string
  有効?: boolean
}

export interface C利用者UpdateRequest {
  利用者ID: string
  利用者名?: string
  パスワード?: string
  権限ID?: string
  利用者備考?: string
  有効?: boolean
}

export interface C利用者DeleteRequest {
  利用者ID: string
}

/**
 * C採番 API
 */
export interface C採番GetRequest {
  採番ID: string
}

export interface C採番CreateRequest {
  採番ID: string
  最終採番値: number
  採番備考?: string
  有効?: boolean
}

export interface C採番UpdateRequest {
  採番ID: string
  最終採番値?: number
  採番備考?: string
  有効?: boolean
}

export interface C採番DeleteRequest {
  採番ID: string
}

export interface C採番次番取得Request {
  採番区分: string
  採番数?: number
}

export interface C採番次番取得Response {
  次番開始: number
  次番終了: number
  次番リスト: number[]
}

/**
 * M配車区分 API
 */
export interface M配車区分GetRequest {
  配車区分ID: string
}

export interface M配車区分CreateRequest {
  配車区分ID: string
  配車区分名: string
  配車区分備考?: string
  配色枠: string
  配色背景: string
  配色前景: string
  有効?: boolean
}

export interface M配車区分UpdateRequest {
  配車区分ID: string
  配車区分名?: string
  配車区分備考?: string
  配色枠?: string
  配色背景?: string
  配色前景?: string
  有効?: boolean
}

export interface M配車区分DeleteRequest {
  配車区分ID: string
}

export interface M生産区分GetRequest {
  生産区分ID: string
}

export interface M生産区分CreateRequest {
  生産区分ID: string
  生産区分名: string
  生産区分備考?: string
  配色枠: string
  配色背景: string
  配色前景: string
  有効?: boolean
}

export interface M生産区分UpdateRequest {
  生産区分ID: string
  生産区分名?: string
  生産区分備考?: string
  配色枠?: string
  配色背景?: string
  配色前景?: string
  有効?: boolean
}

export interface M生産区分DeleteRequest {
  生産区分ID: string
}

/**
 * M車両 API
 */
export interface M車両GetRequest {
  車両ID: string
}

export interface M車両CreateRequest {
  車両ID: string
  車両名: string
  車両備考?: string
  有効?: boolean
}

export interface M車両UpdateRequest {
  車両ID: string
  車両名?: string
  車両備考?: string
  有効?: boolean
}

export interface M車両DeleteRequest {
  車両ID: string
}

/**
 * M生産工程 API
 */
export interface M生産工程GetRequest {
  生産工程ID: string
}

export interface M生産工程CreateRequest {
  生産工程ID: string
  生産工程名: string
  生産工程備考?: string
  有効?: boolean
}

export interface M生産工程UpdateRequest {
  生産工程ID: string
  生産工程名?: string
  生産工程備考?: string
  有効?: boolean
}

export interface M生産工程DeleteRequest {
  生産工程ID: string
}

/**
 * M商品分類 API
 */
export interface M商品分類GetRequest {
  商品分類ID: string
}

export interface M商品分類CreateRequest {
  商品分類ID: string
  商品分類名: string
  商品分類備考?: string
  有効?: boolean
}

export interface M商品分類UpdateRequest {
  商品分類ID: string
  商品分類名?: string
  商品分類備考?: string
  有効?: boolean
}

export interface M商品分類DeleteRequest {
  商品分類ID: string
}

/**
 * M取引先分類 API
 */
export interface M取引先分類GetRequest {
  取引先分類ID: string
}

export interface M取引先分類CreateRequest {
  取引先分類ID: string
  取引先分類名: string
  取引先分類備考?: string
  有効?: boolean
}

export interface M取引先分類UpdateRequest {
  取引先分類ID: string
  取引先分類名?: string
  取引先分類備考?: string
  有効?: boolean
}

export interface M取引先分類DeleteRequest {
  取引先分類ID: string
}

/**
 * M取引先 API
 */
export interface M取引先GetRequest {
  取引先ID: string
}

export interface M取引先CreateRequest {
  取引先ID: string
  取引先名: string
  取引先分類ID: string
  取引先郵便番号?: string
  取引先住所?: string
  取引先電話番号?: string
  取引先メールアドレス?: string
  取引先備考?: string
  有効?: boolean
}

export interface M取引先UpdateRequest {
  取引先ID: string
  取引先名?: string
  取引先分類ID?: string
  取引先郵便番号?: string
  取引先住所?: string
  取引先電話番号?: string
  取引先メールアドレス?: string
  取引先備考?: string
  有効?: boolean
}

export interface M取引先DeleteRequest {
  取引先ID: string
}

/**
 * M商品 API
 */
export interface M商品GetRequest {
  商品ID: string
}

export interface M商品CreateRequest {
  商品ID: string
  商品名: string
  単位: string
  商品分類ID: string
  商品備考?: string
  有効?: boolean
}

export interface M商品UpdateRequest {
  商品ID: string
  商品名?: string
  単位?: string
  商品分類ID?: string
  商品備考?: string
  有効?: boolean
}

export interface M商品DeleteRequest {
  商品ID: string
}

export interface M商品構成明細Request {
  明細SEQ: number
  構成商品ID: string
  計算分子数量: number
  計算分母数量: number
  構成商品備考?: string | null
}

export interface M商品構成GetRequest {
  商品ID: string
}

export interface M商品構成CreateRequest {
  商品ID: string
  最小ロット数量: number
  生産区分ID: string
  生産工程ID: string
  段取分数?: number | null
  時間生産数量?: number | null
  商品構成備考?: string | null
  有効?: boolean
  明細一覧: M商品構成明細Request[]
}

export interface M商品構成UpdateRequest {
  商品ID: string
  最小ロット数量?: number
  生産区分ID?: string
  生産工程ID?: string
  段取分数?: number | null
  時間生産数量?: number | null
  商品構成備考?: string | null
  有効?: boolean
  明細一覧?: M商品構成明細Request[]
}

export interface M商品構成DeleteRequest {
  商品ID: string
}

/**
 * テーブルカラム定義
 */
export interface TableColumn {
  key: string
  label: string
  width?: string
  sortable?: boolean
}

/**
 * フィルタ型定義ヘルパー
 */
export type FilterObject<T> = {
  [K in keyof T]?: string
}
