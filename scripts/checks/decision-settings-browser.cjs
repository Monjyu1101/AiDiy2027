// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 実SFC + 合成APIだけを隔離Chrome/Edgeで確認。実サーバー・Electron・外部APIは使わない。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const {createServer} = require('node:http');
const {spawn} = require('node:child_process');
const {tmpdir} = require('node:os');
const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.env.SETTINGS_QA_OUTPUT || path.join(tmpdir(), 'aidiy-settings-qa'));
fs.mkdirSync(output, {recursive:true});
const projects = {
  frontend_web:'src/components/AiDiy/dialog/AI設定再起動.vue',
  frontend_avatar:'src/dialog/AI設定再起動.vue',
};
function page(project) {
  const req = createRequire(path.join(root, project, 'package.json'));
  const {parse, compileScript, compileStyle} = req('@vue/compiler-sfc');
  const ts = req('typescript');
  const filename = path.join(root, project, projects[project]);
  const {descriptor} = parse(fs.readFileSync(filename, 'utf8'), {filename});
  const script = compileScript(descriptor, {id:'settings-qa', inlineTemplate:true});
  const js = ts.transpileModule(script.content, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
  const css = descriptor.styles.map(style => compileStyle({source:style.content, filename, id:'data-v-settings-qa', scoped:true}).code).join('\n');
  const vue = fs.readFileSync(path.join(root, project, 'node_modules/vue/dist/vue.global.prod.js'), 'utf8');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><title>判断設定 QA</title><style>body{margin:0;font-family:Arial,sans-serif}${css}</style><div id="app"></div><script>${vue}</script><script>
  window.saved={CHAT_AI_NAME:'keep-chat',DECISION_AI_NAME:'freeai_chat',DECISION_GEMINI_MODEL:'retained'};
  window.calls=[];
  window.catalogs={decision_models:{auto:{auto:'auto',oauth:'OAuth',native:'API',gemini:'Gemini'},openai_oauth:{oauth:'2026/10/18 - oauth'},freeai_chat:{},openai_decisions:{native:'2026/10/18 - native'},gemini_chat:{gemini:'2026/10/18 - gemini'}}};
  const api={post:async(url,body)=>{window.calls.push({url,body});if(url.endsWith('/取得'))return {data:{status:'OK',data:{モデル設定:{...window.saved},available_models:window.catalogs}}};if(body.save)window.saved={...body.モデル設定};return {data:{status:'OK'}}}};
  const exports={}; function require(name){if(name==='vue')return Vue;if(name==='@/api/client')return {default:api};if(name.includes('qAlert'))return {qMessage(){},qAlert(){},qConfirm:async()=>true};if(name.endsWith('.vue'))return {default:{render:()=>null}};throw Error(name)};
  ${js}
  exports.default.__scopeId='data-v-settings-qa';
  window.app=Vue.createApp(exports.default,{isOpen:true,sessionId:'isolated-qa'});window.app.mount('#app');
  </script></html>`;
}
async function main() {
  const pages = Object.fromEntries(Object.keys(projects).map(project => [project, page(project)]));
  const server = createServer((req,res) => {const name=req.url.slice(1).split('?')[0];res.setHeader('Content-Type','text/html;charset=utf-8');res.end(pages[name] || 'Not found');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const chromePath=process.env.CHROME_PATH || [path.join(process.env.PROGRAMFILES||'', 'Google/Chrome/Application/chrome.exe'),path.join(process.env['PROGRAMFILES(X86)']||'', 'Microsoft/Edge/Application/msedge.exe')].find(fs.existsSync);
  assert.ok(chromePath,'既存Chrome/Edgeが必要です');
  const profile=fs.mkdtempSync(path.join(tmpdir(),'aidiy-settings-browser-'));
  const chrome=spawn(chromePath,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','about:blank'],{stdio:'ignore',windowsHide:true});
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let ws;
  try {
    let port;
    for(let i=0;i<100&&!port;i++){try{port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0])}catch{await sleep(100)}}
    assert.ok(port,'Browser start timeout');
    const target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');
    ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(resolve=>ws.addEventListener('open',resolve,{once:true}));
    let seq=0;const pending=new Map(),errors=[];
    ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id){pending.get(msg.id)?.(msg);pending.delete(msg.id)}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text)});
    const send=(method,params={})=>new Promise(resolve=>{pending.set(++seq,resolve);ws.send(JSON.stringify({id:seq,method,params}))});
    async function evaluate(expression){const res=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(res.result?.exceptionDetails,undefined,JSON.stringify(res));return res.result.result.value}
    async function until(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(50)}assert.fail(expression)}
    async function choose(id,value){await evaluate(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}));Vue.nextTick()`)}
    await send('Runtime.enable');
    await send('Network.enable');await send('Network.setBlockedURLs',{urls:['https://*','http://localhost:*']});
    const results=[];
    for(const project of Object.keys(projects)) {
      await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
      const url=`http://127.0.0.1:${server.address().port}/${project}`;
      await send('Page.navigate',{url});
      await until(`document.querySelector('#config-DECISION_GEMINI_MODEL')?.value==='retained'`);
      assert.equal(await evaluate(`document.querySelector('#config-DECISION_GEMINI_MODEL').disabled`),false);
      assert.equal(await evaluate(`[...document.querySelector('#config-decision-ai-select').options].map(o=>o.value).join(',')`),'auto,openai_oauth,freeai_chat,openai_decisions,gemini_chat');
      await choose('config-decision-ai-select','gemini_chat');
      assert.equal(await evaluate(`document.querySelector('#config-DECISION_GEMINI_MODEL').value`),'retained');
      await choose('config-DECISION_GEMINI_MODEL','gemini');
      await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='保存(json書換)').click()`);
      await until(`window.saved.DECISION_AI_NAME==='gemini_chat'`);
      assert.equal(await evaluate(`window.saved.DECISION_GEMINI_MODEL`),'gemini');
      assert.equal(await evaluate(`window.saved.CHAT_AI_NAME`),'keep-chat');
      assert.equal(await evaluate(`Object.values(window.calls.at(-1).body.再起動要求).some(Boolean)`),false);
      await choose('config-decision-ai-select','freeai_chat');
      assert.equal(await evaluate(`document.querySelector('#config-DECISION_GEMINI_MODEL').value`),'gemini');
      for(const width of [1280,720,390]) {
        await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
        await evaluate(`document.querySelector('#config-decision-ai-select').scrollIntoView({block:'center'})`);
        await sleep(80);
        assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`),true,`${project} ${width}px overflow`);
        const screenshot=await send('Page.captureScreenshot',{format:'png'});
        fs.writeFileSync(path.join(output,`${project}-${width}.png`),Buffer.from(screenshot.result.data,'base64'));
      }
      // 同じ保存データでコンポーネントを作り直して再読込を確認。
      await evaluate(`window.app.unmount();window.app=Vue.createApp(exports.default,{isOpen:true,sessionId:'isolated-qa'});window.app.mount('#app')`);
      await until(`document.querySelector('#config-decision-ai-select')?.value==='gemini_chat'`);
      assert.equal(await evaluate(`document.querySelector('#config-DECISION_GEMINI_MODEL').value`),'gemini');
      for(const [key,provider] of [['DECISION_OAUTH_MODEL','openai_oauth'],['DECISION_FREEAI_MODEL','freeai_chat'],['DECISION_OPENAI_MODEL','openai_decisions'],['DECISION_GEMINI_MODEL','gemini_chat']]) {
        await evaluate(`window.catalogs.decision_models[${JSON.stringify(provider)}]={'new-from-diag':'2026/10/18 - new-from-diag'};window.app.unmount();window.app=Vue.createApp(exports.default,{isOpen:true,sessionId:'isolated-qa'});window.app.mount('#app')`);
        await until(`document.querySelector('#config-decision-ai-select')`);
        await choose('config-decision-ai-select',provider);
        assert.equal(await evaluate(`document.querySelector('#config-${key}').disabled`),false);
        await choose('config-'+key,'new-from-diag');
        await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='保存(json書換)').click()`);
        await until(`window.saved[${JSON.stringify(key)}]==='new-from-diag' && window.saved.DECISION_AI_NAME===${JSON.stringify(provider)}`);
      }
      results.push({project,passed:true,widths:[1280,720,390],catalog_change_all_four:true,save_reload:true,preserved_other_settings:true});
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({results,console_errors:errors,real_api_calls:false},null,2));
    console.log(JSON.stringify({results,output}));
  } finally {ws?.close();chrome.kill();await new Promise(resolve=>server.close(resolve))}
}
main().catch(error=>{console.error(error);process.exitCode=1});
