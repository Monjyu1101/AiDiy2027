import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHandler} from '../diag_main.mjs';
import {createToolsSettingsBridge,createToolsRepresentativeBridge,TOOLS_SETTINGS_BODY_LIMIT} from '../Tools/設定接続.mjs';
const reader=async()=>JSON.stringify({PORT_TOOLS:8095});
const envelope=(data={},token='fixture.jwt')=>({token,data});
const ok=data=>({status:'OK',data});
async function request(handler,{action='enabled',method='POST',auth='Bearer diag-fixture',body=envelope(),headers={}}={}){
 const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
 Object.assign(req,{url:'/api/Tools/'+action,method,headers:{authorization:auth,'content-type':'application/json',host:'127.0.0.1:8097',...headers}});
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body.toString());}};
 await handler(req,res);return res;
}
test('two fixed routes forward JWT, write false stays false and payload is filtered',async()=>{
 const calls=[];const bridge=createToolsSettingsBridge({reader,requestFn:async r=>{calls.push(r);return ok({tools:[{id:'aidiy_text_to_speech',enabled:true,available:true,status:'ready',API_KEY:'secret'},{id:'unknown',enabled:true}],defaults:{text_to_speech:{auto_provider:'edge',API_KEY:'secret'}},schema:{text_to_speech:{auto_provider:['edge','openai'],secret:['secret']}},saved:false,API_KEY:'secret'});}});
 const output=await bridge('enabled',envelope({enabled:{aidiy_text_to_speech:false},write:false}));
 assert.equal(calls[0].path,'/management/enabled');assert.equal(calls[0].port,8095);assert.equal(calls[0].token,'fixture.jwt');assert.equal(calls[0].data.write,false);
 assert.equal(output.data.tools.length,1);assert.ok(!JSON.stringify(output).includes('secret'));assert.equal(output.data.saved,false);
 await bridge('defaults',envelope({defaults:{text_to_speech:{auto_provider:'edge'}},write:true}));
 assert.equal(calls[1].path,'/management/defaults');assert.equal(calls[1].data.write,true);
});
test('strict input rejects arbitrary URL command path secret settings and absent login',async()=>{
 let calls=0;const bridge=createToolsSettingsBridge({reader,requestFn:async()=>{calls++;return ok({});}});
 for(const [action,input] of [['test',envelope()],['enabled',{data:{}}],['enabled',envelope({},'x\r\ny')],['enabled',envelope({enabled:{x:true}})],['enabled',envelope({enabled:{aidiy_sqlite:'false'}})],['enabled',envelope({url:'http://invalid'})],['defaults',envelope({defaults:{API_KEY:'secret'}})],['defaults',envelope({defaults:{text_to_speech:{command:'whoami'}}})],['defaults',envelope({defaults:{movie_generation:{auto_model:[]}}})],['defaults',envelope({write:1})],['enabled',{...envelope(),url:'http://invalid'}]]){
  await assert.rejects(bridge(action,input),e=>[400,403,404].includes(e.status));
 }
 assert.equal(calls,0);
});
test('invalid ports fail closed, config errors and transport failures are sanitized',async()=>{
 for(const port of [0,65536,'http://invalid',{},'8095/x']){
  const bridge=createToolsSettingsBridge({reader:async()=>JSON.stringify({PORT_TOOLS:port}),requestFn:()=>assert.fail('must not call')});
  await assert.rejects(bridge('enabled',envelope()),e=>e.status===503);
 }
 const bridge=createToolsSettingsBridge({reader,requestFn:async()=>{throw Error('secret');}});
 await assert.rejects(bridge('enabled',envelope()),e=>e.status===503&&!e.message.includes('secret'));
});
test('auth failure returns authExpired and backend errors never echo secrets',async()=>{
 const expired=createToolsSettingsBridge({reader,requestFn:async()=>({authExpired:true})});
 assert.equal((await expired('enabled',envelope())).authExpired,true);
 const bad=createToolsSettingsBridge({reader,requestFn:async()=>({status:'NG',message:'secret',data:{secret:'secret'}})});
 assert.ok(!JSON.stringify(await bad('enabled',envelope())).includes('secret'));
});
test('bounded reads and calls cancel without external requests',async()=>{
 const config=createToolsSettingsBridge({reader:()=>new Promise(()=>{}),timeoutMs:5});
 await assert.rejects(config('enabled',envelope()),e=>e.status===503);
 const calls=createToolsSettingsBridge({reader,requestFn:()=>new Promise(()=>{}),timeoutMs:5});
 await assert.rejects(calls('enabled',envelope()),e=>e.status===503);
 const controller=new AbortController();controller.abort();
 await assert.rejects(calls('enabled',envelope(),{signal:controller.signal}),e=>e.status===503);
});
test('Diag gates both APIs with bearer, POST JSON, same-origin, body cap and known actions',async()=>{
 let calls=0;const handler=createHandler({token:'diag-fixture',toolsSettingsBridge:async()=>{calls++;return {status:'NG',authExpired:true};}});
 for(const [options,status] of [[{auth:''},401],[{action:'test'},404],[{method:'GET'},405],[{headers:{origin:'https://evil.invalid'}},403],[{headers:{'sec-fetch-site':'cross-site'}},403],[{headers:{'content-type':'text/plain'}},400],[{body:'{'},400],[{headers:{'content-length':String(TOOLS_SETTINGS_BODY_LIMIT+1)}},413],[{body:' '.repeat(TOOLS_SETTINGS_BODY_LIMIT+1)},413]])assert.equal((await request(handler,options)).status,status);
 assert.equal(calls,0);
 for(const action of ['enabled','defaults']){
  const response=await request(handler,{action,headers:{origin:'http://127.0.0.1:8097'}});assert.equal(response.status,200);assert.equal(response.body.authExpired,true);
 }
 assert.equal(calls,2);
});


test('representative authenticates every operation then availability, calls only fixed browser session',async()=>{
 const calls=[];
 const bridge=createToolsRepresentativeBridge({reader,requestFn:async r=>{
  calls.push(r);
  if(r.path==='/core/auth/現在利用者')return ok({利用者ID:'fixture'});
  if(r.path==='/management/enabled')return ok({tools:[{id:'aidiy_chrome_devtools',enabled:true,available:true}]});
  if(r.path.endsWith('open_session'))return {result:'起動しました',session:{running:true,profile_dir:'secret'}};
  if(r.path.endsWith('close_session'))return {result:'停止しました'};
  assert.fail('unexpected path');
 }});
 for(const operation of ['open','close']){
  const result=await bridge(envelope({operation,headless:true}));assert.equal(result.status,'OK');assert.ok(!JSON.stringify(result).includes('secret'));
 }
 assert.deepEqual(calls.map(r=>r.path),['/core/auth/現在利用者','/management/enabled','/aidiy_chrome_devtools/open_session','/core/auth/現在利用者','/management/enabled','/aidiy_chrome_devtools/close_session']);
 assert.equal(calls[0].port,8091);assert.equal(calls[2].port,8095);
 assert.deepEqual(calls[2].data,{session:'diag-tools-test',headless:true,show_automation_banner:true});
 assert.deepEqual(calls[5].data,{session:'diag-tools-test'});
});
test('representative denies arbitrary actions, target inputs, missing login and never runs disabled tool',async()=>{
 let calls=0;const bridge=createToolsRepresentativeBridge({reader,requestFn:async r=>{
  calls++;if(r.path==='/core/auth/現在利用者')return ok({});
  if(r.path==='/management/enabled')return ok({tools:[{id:'aidiy_chrome_devtools',enabled:false,available:true}]});
  assert.fail('must not run tool');
 }});
 for(const input of [{operation:'exec'}, {operation:'open',url:'https://invalid'}, {operation:'open',path:'/tmp'}, {operation:'open',session:'default'}, {operation:'open',headless:1}])await assert.rejects(bridge(envelope(input)),e=>e.status===400);
 await assert.rejects(bridge({data:{operation:'open'}}),e=>e.status===403);
 assert.equal(calls,0);assert.equal((await bridge(envelope({operation:'open'}))).status,'NG');assert.equal(calls,2);
});
test('representative expires auth before checking tools and rejects false success response',async()=>{
 let calls=0;const expired=createToolsRepresentativeBridge({reader,requestFn:async()=>{calls++;return {authExpired:true};}});
 assert.equal((await expired(envelope({operation:'open'}))).authExpired,true);assert.equal(calls,1);
 const failed=createToolsRepresentativeBridge({reader,requestFn:async r=>r.path==='/core/auth/現在利用者'?ok({}):r.path==='/management/enabled'?ok({tools:[{id:'aidiy_chrome_devtools',enabled:true,available:true}]}):{status:'NG',available:false,message:'secret'}});
 const response=await failed(envelope({operation:'open'}));assert.equal(response.status,'NG');assert.ok(!JSON.stringify(response).includes('secret'));
});
test('representative route shares Diag auth and origin protections',async()=>{
 let calls=0;const handler=createHandler({token:'diag-fixture',toolsRepresentativeBridge:async()=>{calls++;return ok({});}});
 assert.equal((await request(handler,{action:'representative',auth:''})).status,401);
 assert.equal((await request(handler,{action:'representative',headers:{origin:'http://evil.invalid'}})).status,403);
 assert.equal(calls,0);
 assert.equal((await request(handler,{action:'representative',body:envelope({operation:'open'})})).status,200);assert.equal(calls,1);
});
