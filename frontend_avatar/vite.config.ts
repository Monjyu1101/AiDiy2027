// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

const PORT_CORE = 8091
const PORT_AVATAR = 8092
const PORT_APPS = 8098

export default defineConfig({
  clearScreen: false,
  plugins: [vue()],
  optimizeDeps: {
    include: [
      'monaco-editor',
      'three',
      '@pixiv/three-vrm',
      '@pixiv/three-vrm-animation',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: PORT_AVATAR,
    strictPort: true,
    proxy: {
      '/core': {
        target: `http://127.0.0.1:${PORT_CORE}`,
        changeOrigin: true,
        ws: true,
      },
      '/apps': {
        target: `http://127.0.0.1:${PORT_APPS}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
