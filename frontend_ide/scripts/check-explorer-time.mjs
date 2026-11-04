// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実Vueの時刻プリセットを隔離Chromiumで確認。API・ファイル一覧はメモリfixtureのみ。
import assert from 'node:assert/strict';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const chromePath = process.env.CHROME_PATH || ['/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
assert.ok(chromePath, 'CHROME_PATH で Chrome / Edge を指定してください。');
const output = mkdtempSync(join(tmpdir(), 'aidiy-explorer-time-'));
const entry = join(output, 'entry.js');
writeFileSync(entry, `
import {createApp,h,reactive,nextTick} from 'vue';
import Explorer from ${JSON.stringify(join(root, 'src/components/ファイル閲覧/ファイル一覧.vue'))};
import ${JSON.stringify(join(root, 'src/style.css'))};
const now=new Date(2026,9,28,14,0,0).getTime();Date.now=()=>now;
const at=(h,m=0,s=0,ms=0)=>new Date(2026,9,28,h,m,s,ms).getTime();
const files=[['previous.txt',1,at(0)-1],['midnight.txt',1,at(0)],['before.txt',1,at(12,29,59,999)],['boundary.txt',1,at(12,30)],['after.txt',1,at(12,30,0,1)],['recent.txt',1,at(13,50)],['last.txt',1,at(24)-1],['next.txt',1,at(24)]];
const state=reactive({root:'/fixture',startedAt:at(13),open:true,tree:{n:'fixture',d:[],f:files},selected:'',current:''});
const log={requests:[],errors:[],marks:[]};
window.addEventListener('error',e=>log.errors.push(e.message));window.addEventListener('unhandledrejection',e=>log.errors.push(String(e.reason)));
window.fetch=async(url,options={})=>{log.requests.push({url:String(url),method:options.method||'GET'});if(options.method&&options.method!=='GET')throw Error('Mutation forbidden');if(String(url).startsWith('/api/latest'))return new Response(JSON.stringify({files:[]}));if(String(url).startsWith('/api/ai-search/history'))return new Response(JSON.stringify({entries:[]}));throw Error('Network forbidden: '+url);};
const app=createApp({render:()=>h('main',{class:'development-app ide'},[h('section',{class:'space-view'},[h(Explorer,{...state,filter:false,viewHistory:[],viewVoyages:{},onMarks:value=>log.marks.push(value),'onUpdate:open':value=>state.open=value})])])});
app.mount('#app');window.fixture={state,log,now,at,nextTick,unmount:()=>app.unmount(),ready:true};
`);
const bundle = await build({ root, configFile: false, logLevel: 'warn', plugins: [vue()], resolve: { alias: { vue: join(root, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } }, define: { 'process.env.NODE_ENV': JSON.stringify('production') }, build: { write: false, minify: false, cssCodeSplit: false, lib: { entry, name: 'TimeFixture', formats: ['iife'] } } });
const chunks = Array.isArray(bundle) ? bundle.flatMap(value => value.output) : bundle.output;
const javascript = chunks.filter(value => value.type === 'chunk').map(value => value.code).join('\n');
const css = chunks.filter(value => value.type === 'asset' && value.fileName.endsWith('.css')).map(value => value.source).join('\n');
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'"><style>${css}</style><style>html,body,#app{margin:0;width:100%;height:100%;background:#111a2a}.space-view{--workspace-top:20px;--explorer-width:360px}.space-view .explorer-panel{top:20px;bottom:20px;left:20px}</style><div id="app"></div><script>${javascript.replaceAll('</script', '<\\/script')}</script></html>`;
writeFileSync(join(output, 'fixture.html'), html);
const profile = join(output, 'profile');
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeError = '', chromeLaunchFailed = false;
chrome.stderr.setEncoding('utf8');
chrome.stderr.on('data', value => { chromeError = (chromeError + value).slice(-8000);appendFileSync(join(output, 'chromium-stderr.log'), value); });
chrome.on('error', error => { chromeLaunchFailed = true;chromeError += String(error);appendFileSync(join(output, 'chromium-stderr.log'), String(error)); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let ws;
try {
  let port;
  for (let n = 0; n < 100 && !port && !chromeLaunchFailed && chrome.exitCode === null && chrome.signalCode === null; n++) { try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); } }
  assert.ok(port, `Chromium debugging port unavailable (exit=${chrome.exitCode}, signal=${chrome.signalCode}); artifacts: ${output}\n${chromeError}`);
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(value => value.type === 'page');
  ws = new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}));
  let sequence = 0;const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data);if (message.id) { pending.get(message.id)?.(message);pending.delete(message.id); } });
  const send = (method, params = {}) => new Promise(resolve => { pending.set(++sequence, resolve);ws.send(JSON.stringify({id:sequence, method, params})); });
  async function evaluate(expression) { const response = await send('Runtime.evaluate', {expression,returnByValue:true,awaitPromise:true,userGesture:true});assert.equal(response.error,undefined);assert.equal(response.result?.exceptionDetails,undefined,JSON.stringify(response.result?.exceptionDetails));return response.result.result.value; }
  async function until(expression) { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return;await sleep(40); } assert.fail(expression); }
  await send('Emulation.setDeviceMetricsOverride',{width:900,height:720,deviceScaleFactor:1,mobile:false});
  await send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Tokyo'});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await send('Page.navigate',{url:'data:text/html,'+encodeURIComponent(html)});
  await until('window.fixture?.ready');
  const labels = await evaluate(`Array.from(document.querySelectorAll('.since-presets button'),b=>b.textContent)`);
  assert.deepEqual(labels,['起動','15分','1時間','2時間','午前','今日','午後','解除']);
  async function choose(label, expected) {
    await evaluate(`(async()=>{Array.from(document.querySelectorAll('.since-presets button')).find(b=>b.textContent===${JSON.stringify(label)}).click();await fixture.nextTick();})()`);
    await until(`document.querySelectorAll('[role=treeitem]').length===8`);
    const actual = await evaluate(`Array.from(document.querySelectorAll('[role=treeitem].fresh'),b=>b.dataset.path).sort()`);
    assert.deepEqual(actual,[...expected].sort(),label);
    assert.equal(await evaluate(`document.querySelector('.since-presets button[aria-pressed=true]').textContent`),label);
    assert.equal(await evaluate(`document.querySelector('#time-search-error').textContent`),'');
  }
  const morning=['midnight.txt','before.txt'];
  const afternoon=['boundary.txt','after.txt','recent.txt','last.txt'];
  await choose('午前',morning);await choose('午後',afternoon);await choose('今日',[...morning,...afternoon]);
  await choose('午前',morning);await choose('午前',morning);await choose('午後',afternoon);
  await choose('解除',[]);
  await choose('午前',morning);
  await choose('15分',['recent.txt','last.txt','next.txt']);
  assert.equal(await evaluate(`document.querySelectorAll('.time-search input')[1].value`),'');
  assert.equal(await evaluate('fixture.log.marks.at(-1).until'),null);
  await choose('1時間',['recent.txt','last.txt','next.txt']);
  await choose('2時間',['before.txt','boundary.txt','after.txt','recent.txt','last.txt','next.txt']);
  await choose('起動',['recent.txt','last.txt','next.txt']);
  await choose('午前',morning);
  assert.equal(await evaluate(`document.querySelectorAll('.time-search input')[1].value`),'2026-10-28T12:29:59');
  await evaluate(`document.querySelectorAll('.time-search input')[1].dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate('fixture.log.marks.at(-1).until'),await evaluate('fixture.at(12,30)'));
  assert.equal(await evaluate(`document.querySelector('.since-presets button[aria-pressed=true]')`),null);
  await choose('午前',morning);
  const bounds = await evaluate(`(()=>{const panel=document.querySelector('.explorer-panel').getBoundingClientRect();return Array.from(document.querySelectorAll('.since-presets button'),b=>{const r=b.getBoundingClientRect();return {label:b.textContent,inside:r.left>=panel.left&&r.right<=panel.right&&r.bottom<=panel.bottom,width:r.width,height:r.height};});})()`);
  assert.ok(bounds.every(value=>value.inside&&value.width>0&&value.height>0),JSON.stringify(bounds));
  const shot = await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,'morning.png'),Buffer.from(shot.result.data,'base64'));
  await evaluate(`document.querySelectorAll('.time-search input')[1].value='2026-10-28T12:30:00';document.querySelectorAll('.time-search input')[1].dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`fixture.log.marks.at(-1).until`),await evaluate('fixture.at(12,30)+1000'));
  await choose('午後',afternoon);
  await evaluate(`document.querySelector('input[value=grep]').click();document.querySelector('input[value=since]').click()`);
  assert.equal(await evaluate(`document.querySelector('.since-presets button[aria-pressed=true]').textContent`),'午後');
  assert.deepEqual(await evaluate('fixture.log.errors'),[]);
  const result={passed:true,timezone:'Asia/Tokyo',labels,bounds,requests:await evaluate('fixture.log.requests'),screenshots:[join(output,'morning.png')],checks:['real Vue preset ordering and selected state','12:30 exclusive morning / inclusive afternoon','local-day boundaries','repeated selection and reset','15 minutes / 1 hour / 2 hours / start','manual end keeps inclusive-second contract','grep and time mode roundtrip'],limitations:['Headless Chromium fixture; not Windows Electron integration']};
  await evaluate('fixture.unmount()');
  writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
} catch (error) {
  writeFileSync(join(output, 'failure.txt'), String(error.stack || error));
  console.error(`Explorer time QA did not complete; artifacts: ${output}`);
  throw error;
} finally { ws?.close();chrome.kill(); }
