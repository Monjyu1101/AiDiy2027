// -*- coding: utf-8 -*-

// -------------------------------------------------------------------------
// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// -------------------------------------------------------------------------

// qAlert / qConfirm は createApp で DOM に直接マウントするため AiDiy.vue 登録不要。
// qColorPicker のみインスタンスパターンを維持する。

import { createApp } from 'vue'
import QAlertComponent from '@taskteam/_share/qAlert.vue'
import QMessageComponent from '@taskteam/_share/qMessage.vue'

// -- ColorPicker: インスタンスパターン --

interface ColorPickerDialogInstance {
  show: (initialColor: string, title: string) => Promise<string | null>
}

let colorPickerInstance: ColorPickerDialogInstance | null = null

export function setColorPickerInstance(instance: ColorPickerDialogInstance): void {
  colorPickerInstance = instance
}

// -- Alert: 重複表示を防ぐ --

let activeAlert = false

export function qAlert(message: string): Promise<void> {
  if (activeAlert) return Promise.resolve()
  activeAlert = true
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      activeAlert = false
      app.unmount()
      container.remove()
      resolve()
    }
    const app = createApp(QAlertComponent, { message: String(message ?? ''), onOk: close })
    app.mount(container)
  })
}

// -- Confirm: 重複表示を防ぐ --

let activeConfirm = false

export function qConfirm(message: string): Promise<boolean> {
  if (activeConfirm) return Promise.resolve(false)
  activeConfirm = true
  return new Promise((resolve) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let closed = false
    const close = (result: boolean) => {
      if (closed) return
      closed = true
      activeConfirm = false
      app.unmount()
      container.remove()
      resolve(result)
    }
    const app = createApp(QAlertComponent, {
      message: String(message ?? ''),
      showCancel: true,
      onOk: () => close(true),
      onCancel: () => close(false),
    })
    app.mount(container)
  })
}

// -- Message: 前のメッセージを置き換える --

let activeMessageClose: (() => void) | null = null

export function qMessage(message: string, type = 'success', durationMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    activeMessageClose?.()
    const container = document.createElement('div')
    document.body.appendChild(container)
    let closed = false
    const close = () => {
      if (closed) return
      closed = true
      if (activeMessageClose === close) activeMessageClose = null
      app.unmount()
      container.remove()
      resolve()
    }
    activeMessageClose = close
    const app = createApp(QMessageComponent, {
      message: String(message ?? ''),
      type,
      durationMs,
      onClose: close,
    })
    app.mount(container)
  })
}

// -- ColorPicker --

export async function qColorPicker(initialColor = '#000000', title = '色選択'): Promise<string | null> {
  if (!colorPickerInstance) {
    console.error('qColorPicker not initialized. Please add qColorPickerDialog to your AiDiy.vue')
    return null
  }
  return await colorPickerInstance.show(initialColor, title)
}

