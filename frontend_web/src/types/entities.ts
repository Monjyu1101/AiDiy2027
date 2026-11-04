// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

import type { AuditFields } from './common'

/**
 * CRITICAL: All ID fields are STRING type, not number!
 * バックエンドは文字列でIDを返します: {"権限ID": "1", "利用者ID": "USR001"}
 */

// ==================== C系（共通・管理） ====================

/**
 * C権限（権限マスタ）
 */
export interface C権限 extends AuditFields {
  権限ID: string  // STRING, not number!
  権限名: string
  権限備考: string | null
  有効: boolean
}

/**
 * C利用者（利用者マスタ）
 */
export interface C利用者 extends AuditFields {
  利用者ID: string  // STRING, not number!
  利用者名: string
  パスワード: string
  権限ID: string    // STRING, not number!
  利用者備考: string | null
  有効: boolean
}

/**
 * C採番（採番管理）
 */
export interface C採番 extends AuditFields {
  採番ID: string
  最終採番値: number
  採番備考: string | null
  有効: boolean
}

// ==================== M系（マスタ） ====================

/**
 * M車両（車両マスタ）
 */
export interface M車両 extends AuditFields {
  車両ID: string
  車両名: string
  車両備考: string | null
  有効: boolean
}

/**
 * M生産工程（生産工程マスタ）
 */
export interface M生産工程 extends AuditFields {
  生産工程ID: string
  生産工程名: string
  生産工程備考: string | null
  有効: boolean
}

/**
 * M商品分類（商品分類マスタ）
 */
export interface M商品分類 extends AuditFields {
  商品分類ID: string
  商品分類名: string
  商品分類備考: string | null
  有効: boolean
}

/**
 * M取引先分類（取引先分類マスタ）
 */
export interface M取引先分類 extends AuditFields {
  取引先分類ID: string
  取引先分類名: string
  取引先分類備考: string | null
  有効: boolean
}

/**
 * M取引先（取引先マスタ）
 */
export interface M取引先 extends AuditFields {
  取引先ID: string
  取引先名: string
  取引先分類ID: string
  取引先郵便番号: string | null
  取引先住所: string | null
  取引先電話番号: string | null
  取引先メールアドレス: string | null
  取引先備考: string | null
  有効: boolean
}

/**
 * M商品（商品マスタ）
 */
export interface M商品 extends AuditFields {
  商品ID: string
  商品名: string
  単位: string
  商品分類ID: string
  商品備考: string | null
  有効: boolean
}

export interface M商品構成明細 {
  明細SEQ: number
  構成商品ID: string
  構成商品名?: string | null
  計算分子数量: number
  計算分母数量: number
  最小ロット構成数量?: number | null
  構成単位?: string | null
  構成商品備考: string | null
}

export interface M商品構成 extends AuditFields {
  商品ID: string
  商品名?: string | null
  単位?: string | null
  最小ロット数量: number
  生産区分ID: string
  生産区分名?: string | null
  生産工程ID: string
  段取分数?: number | null
  時間生産数量?: number | null
  商品構成備考: string | null
  有効: boolean
  明細一覧: M商品構成明細[]
}

export interface M生産区分 extends AuditFields {
  生産区分ID: string
  生産区分名: string
  生産区分備考: string | null
  配色枠?: string | null
  配色背景?: string | null
  配色前景?: string | null
  有効: boolean
}

/**
 * M配車区分（配車区分マスタ）
 */
export interface M配車区分 extends AuditFields {
  配車区分ID: string
  配車区分名: string
  配車区分備考: string | null
  配色枠?: string | null
  配色背景?: string | null
  配色前景?: string | null
  有効: boolean
}

// ==================== T系（トランザクション） ====================

/**
 * T配車（配車トランザクション）
 */
export interface T配車 extends AuditFields {
  配車ID: string
  配車日: string
  車両ID: string
  配車区分ID: string
  配車備考: string | null
  有効: boolean
}

/**
 * T商品入庫（商品入庫トランザクション）
 */
export interface T商品入庫明細 {
  明細SEQ: number
  商品ID: string
  商品名?: string | null
  単位?: string | null
  入庫数量: number
  明細備考?: string | null
}

export interface T商品入庫 extends AuditFields {
  入庫伝票ID: string
  入庫日: string
  入庫備考: string | null
  有効: boolean
  入庫商品件数?: number
  合計入庫数量?: number
  明細一覧: T商品入庫明細[]
}

/**
 * T商品出庫（商品出庫トランザクション）
 */
export interface T商品出庫明細 {
  明細SEQ: number
  商品ID: string
  商品名?: string | null
  単位?: string | null
  出庫数量: number
  明細備考?: string | null
}

export interface T商品出庫 extends AuditFields {
  出庫伝票ID: string
  出庫日: string
  出庫備考: string | null
  有効: boolean
  出庫商品件数?: number
  合計出庫数量?: number
  明細一覧: T商品出庫明細[]
}

/**
 * T商品棚卸（商品棚卸トランザクション）
 */
export interface T商品棚卸明細 {
  明細SEQ: number
  商品ID: string
  商品名?: string | null
  単位?: string | null
  実棚数量: number
  明細備考?: string | null
}

export interface T商品棚卸 extends AuditFields {
  棚卸伝票ID: string
  棚卸日: string
  棚卸備考: string | null
  有効: boolean
  棚卸商品件数?: number
  合計実棚数量?: number
  明細一覧: T商品棚卸明細[]
}

// ==================== V系（ビュー） ====================

/**
 * V利用者（利用者ビュー - JOIN結果）
 */
export interface V利用者 extends C利用者 {
  権限名: string
}

/**
 * V車両（車両ビュー）
 */
export interface V車両 extends M車両 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V生産工程（生産工程ビュー）
 */
export interface V生産工程 extends M生産工程 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V商品分類（商品分類ビュー）
 */
export interface V商品分類 extends M商品分類 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V取引先分類（取引先分類ビュー）
 */
export interface V取引先分類 extends M取引先分類 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V取引先（取引先ビュー）
 */
export interface V取引先 extends M取引先 {
  取引先分類名?: string | null
}

/**
 * V商品（商品ビュー）
 */
export interface V商品 extends M商品 {
  商品分類名?: string | null
}

export interface V商品構成 extends AuditFields {
  商品ID: string
  商品名?: string | null
  単位?: string | null
  最小ロット数量: number
  生産区分ID?: string | null
  生産区分名?: string | null
  生産工程ID?: string | null
  生産工程名?: string | null
  段取分数?: number | null
  時間生産数量?: number | null
  商品構成備考: string | null
  有効: boolean
  構成商品件数: number
  }

export interface V生産区分 extends M生産区分 {
}

/**
 * V配車区分（配車区分ビュー）
 */
export interface V配車区分 extends M配車区分 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V配車（配車ビュー）
 */
export interface V配車 extends T配車 {
  車両名?: string
  配車区分名?: string
}

/**
 * V商品入庫（商品入庫ビュー）
 */
export interface V商品入庫 extends T商品入庫 {
  商品ID?: string | null
  商品名?: string | null
  単位?: string | null
  商品備考?: string | null
  入庫内容?: string
}

/**
 * V商品出庫（商品出庫ビュー）
 */
export interface V商品出庫 extends T商品出庫 {
  一覧行ID?: string
  明細SEQ?: number
  商品ID?: string | null
  商品名?: string | null
  単位?: string | null
  商品備考?: string | null
}

/**
 * V商品棚卸（商品棚卸ビュー）
 */
export interface V商品棚卸 extends T商品棚卸 {
  一覧行ID?: string
  明細SEQ?: number
  商品ID?: string | null
  商品名?: string | null
  単位?: string | null
  商品備考?: string | null
}

/**
 * V商品推移表（商品推移集計ビュー）
 */
export interface V商品推移表 {
  商品ID: string
  商品名: string
  入庫合計: number
  出庫合計: number
  棚卸合計: number
  在庫数: number
}

/**
 * V採番（採番ビュー）
 */
export interface V採番 extends C採番 {
  // 追加のビュー固有フィールドがあればここに定義
}

/**
 * V権限（権限ビュー）
 */
export interface V権限 extends C権限 {
  // 追加のビュー固有フィールドがあればここに定義
}
