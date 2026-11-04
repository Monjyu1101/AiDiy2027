// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * dev-filter.cjs
 * electronmon の stdout / stderr 両方から WebRTC/WGC ノイズログをフィルタするラッパー。
 * アプリ（Electron）が自分で終了したら electronmon を止めて終了し、dev-start に開発サーバーごと回収させる。
 */
'use strict'

const { spawn } = require('node:child_process')
const readline = require('node:readline')

const SUPPRESS_PATTERNS = [
  // WebRTC デスクトップキャプチャ系ノイズ（WGC/DXGI）を一括抑止
  /desktop_capture/i,
  /ProcessFrame failed/i,
  /DxgiDuplicator/i,
  /Duplication failed/i,
  /wgc_capture/i,
]

// 窓を閉じた等でアプリが終了したときの electronmon の案内。ファイル変更による再起動（restarting app）は含まない。
const APP_CLOSED = /\bapp exited (?:with code -?\d+|due to signal \([^)]*\)), waiting for change to restart it\b/

function shouldSuppress(line) {
  return SUPPRESS_PATTERNS.some((re) => re.test(line))
}

function isAppClosed(line) {
  return APP_CLOSED.test(line)
}

function pipeFiltered(input, output, onLine) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity })
  rl.on('line', (line) => {
    if (!shouldSuppress(line)) {
      output.write(line + '\n')
    }
    onLine(line)
  })
}

function main() {
  const electronmonCli = require.resolve('electronmon/bin/cli.js')
  const child = spawn(process.execPath, [electronmonCli, ...process.argv.slice(2)], {
    windowsHide: true,
    stdio: ['inherit', 'pipe', 'pipe'],
    env: process.env,
  })

  let appClosed = false
  const onLine = (line) => {
    if (appClosed || !isAppClosed(line)) return
    // 再起動待ちのまま残ると、次回のAvatar起動が「起動済み」と判定されて窓が開かない。
    appClosed = true
    child.kill()
  }
  pipeFiltered(child.stdout, process.stdout, onLine)
  pipeFiltered(child.stderr, process.stderr, onLine)

  child.on('error', (err) => {
    process.stderr.write(`[dev-filter] spawn error: ${err.message}\n`)
  })

  child.on('exit', (code, signal) => {
    if (appClosed) {
      process.exit(0)
    } else if (signal) {
      process.kill(process.pid, signal)
    } else {
      process.exit(code ?? 0)
    }
  })
}

module.exports = { isAppClosed, shouldSuppress }
if (require.main === module) main()
