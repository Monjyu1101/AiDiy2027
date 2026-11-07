// ナビ待機画面（9種）を単体表示する撮影用バンドルを temp/ナビ待機画面撮影/dist へ作る。製品の dist は変更しない。
// 実行: node frontend_ide/checks/ナビ待機画面撮影/build.mjs
import {pathToFileURL, fileURLToPath} from 'node:url';
import {join} from 'node:path';
const here = fileURLToPath(new URL('.', import.meta.url));
const ide = join(here, '../..');
const repo = join(ide, '..');
const {build} = await import(pathToFileURL(join(ide, 'node_modules/vite/dist/node/index.js')).href);
const vue = (await import(pathToFileURL(join(ide, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')).href)).default;
process.env.CI = process.env.CI || '1'; // 日本語パスで端末進捗表示が止まるのを避ける
await build({
  root: here, configFile: false, logLevel: 'error', plugins: [vue()],
  resolve: {alias: {'@s': join(ide, 'src/components/開発スペース'), vue: join(ide, 'node_modules/vue/dist/vue.runtime.esm-bundler.js')}},
  define: {'process.env.NODE_ENV': JSON.stringify('production'), __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false},
  build: {outDir: join(repo, 'temp/ナビ待機画面撮影/dist'), emptyOutDir: true, cssCodeSplit: false, minify: false,
    lib: {entry: join(here, 'main.js'), name: 'ScenePreview', formats: ['iife'], fileName: () => 'scene.js', cssFileName: 'scene'}},
});
console.log('built');
