import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../packages/coding-agent/src/experimental/source-resolver.ts";
const { registerCliProviders } = await import("../aidiy/aidiy-cli.ts");
test("chat emits native toolUse and replays results; passthrough stays text", { skip: process.platform === "win32" }, async () => {
 const root=mkdtempSync(join(tmpdir(),"pi-cli-chat-"));
 try {
  const bin=join(root,"backend_tools/.venv/bin"); mkdirSync(bin,{recursive:true});
  writeFileSync(join(bin,"python"), `#!/bin/sh\ncat > '${root}/request.json'\ncat '${root}/answer.json'\n`,{mode:0o700});
  let config;
  const pi={on(){},registerProvider(name,value){config=value;}};
  registerCliProviders(pi,root,{copilot_cli:{same:"same"}});
  const model={id:"same",api:"aidiy-copilot_cli",provider:"copilot_cli"};
  const context={messages:[{role:"system",content:"outer",toolsAdded:[{name:"read",description:"read",parameters:{type:"object"}}],timestamp:0},{role:"user",content:"read",timestamp:0}]};
  writeFileSync(join(root,"answer.json"),JSON.stringify({type:"result",ok:true,text:'説明\n{"content":"","tool_calls":[{"name":"read","arguments":{"path":"x"}}]}\n完了'})+"\n");
  const stream=config.streamSimple(model,context,{}); const events=[]; for await (const e of stream) events.push(e);
  const first=events.at(-1).message;
  assert.equal(first.stopReason,"toolUse"); assert.equal(first.content.at(-1).type,"toolCall");
  assert.ok(events.some(e=>e.type==="toolcall_end"));
  let request=JSON.parse(readFileSync(join(root,"request.json"),"utf8"));
  assert.equal(request.cli_mode,"chat"); assert.equal(request.tools[0].function.name,"read");
  context.messages.push(first,{role:"toolResult",toolCallId:first.content.at(-1).id,toolName:"read",content:[{type:"text",text:"contents"}],isError:false,timestamp:1});
  writeFileSync(join(root,"answer.json"),JSON.stringify({type:"result",ok:true,text:'```json\n{"content":"done","tool_calls":[]}\n```'})+"\n");
  const answer=await config.streamSimple(model,context,{}).result(); assert.equal(answer.stopReason,"stop");
  request=JSON.parse(readFileSync(join(root,"request.json"),"utf8")); assert.equal(request.messages.at(-1).tool_call_id,first.content.at(-1).id); assert.match(request.engine_prompt,/単一の JSON/);
  registerCliProviders(pi,root,{copilot_cli:{same:"same"}},false,"passthrough");
  writeFileSync(join(root,"answer.json"),JSON.stringify({type:"result",ok:true,text:"legacy"})+"\n");
  const old=await config.streamSimple(model,context,{}).result(); assert.equal(old.content.at(-1).text,"legacy");
  request=JSON.parse(readFileSync(join(root,"request.json"),"utf8")); assert.equal(request.cli_mode,"passthrough"); assert.equal(typeof request.prompt,"string");
 } finally {rmSync(root,{recursive:true,force:true});}
});

async function retryFixture(responses, run, exitCode = 0) {
 const root=mkdtempSync(join(tmpdir(),"pi-cli-retry-"));
 try {
  const bin=join(root,"backend_tools/.venv/bin"); mkdirSync(bin,{recursive:true});
  writeFileSync(join(bin,"python"), `#!/bin/sh
n=$(cat '${root}/count' 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > '${root}/count'
cat > "${root}/request$n.json"
cat "${root}/answer$n.json"
exit ${exitCode}
`,{mode:0o700});
  responses.forEach((response,index)=>writeFileSync(join(root,`answer${index+1}.json`),JSON.stringify(response)+"\n"));
  let config, before;
  const notifications = [];
  registerCliProviders({on(_name, callback){before=callback;},registerProvider(_name,value){config=value;}},root,{copilot_cli:{same:"same"}},true);
  await before({}, {cwd:root,hasUI:true,ui:{notify:(...args)=>notifications.push(args)}});
  const model={id:"same",api:"aidiy-copilot_cli",provider:"copilot_cli"};
  const context={messages:[{role:"system",content:"outer",toolsAdded:[{name:"read",description:"read",parameters:{type:"object",required:["path"],additionalProperties:false,properties:{path:{type:"string"}}}}],timestamp:0},{role:"user",content:"昨日の更新ファイルを確認して報告",timestamp:0}]};
  await run({root,config,model,context,notifications,count:()=>Number(readFileSync(join(root,"count"),"utf8"))});
 } finally {rmSync(root,{recursive:true,force:true});}
}
const result=text=>({type:"result",ok:true,text});
test("syntax repair retries once with same constraints and emits only validated native tool calls",{skip:process.platform==="win32"},async()=>{
 await retryFixture([result('{"content":"bad\nquote","tool_calls":[]}'),result('{"content":"","tool_calls":[{"name":"read","arguments":{"path":"README.md"}}]}')],async({root,config,model,context,count})=>{
  const events=[]; for await(const e of config.streamSimple(model,context,{})) events.push(e);
  const answer=events.at(-1).message;
  assert.equal(answer.stopReason,"toolUse"); assert.equal(count(),2);
  assert.equal(events.filter(e=>e.type==="toolcall_end").length,1);
  const first=JSON.parse(readFileSync(join(root,"request1.json"),"utf8"));
  const second=JSON.parse(readFileSync(join(root,"request2.json"),"utf8"));
  assert.ok(second.engine_prompt.startsWith(first.engine_prompt)); assert.match(second.engine_prompt,/再生成/);
  assert.equal(second.mode,"read-only"); assert.equal(second.provider,first.provider); assert.equal(second.model,first.model);
  assert.deepEqual(second.messages,first.messages); assert.deepEqual(second.tools,first.tools);
  assert.ok(second.engine_prompt.includes(JSON.stringify('{"content":"bad\nquote","tool_calls":[]}')));
  assert.match(second.engine_prompt,/必要な返答形式（再掲）/);
  assert.ok(!JSON.stringify(events).includes('bad'));
 });
});
test("repair is bounded; schema violations, transport and authentication failures never retry",{skip:process.platform==="win32"},async()=>{
 const cases=[
  [result("not json"),result("still not json")],
  [result('{"content":"","tool_calls":[{"name":"shell","arguments":{}}]}')],
  [result('{"content":"","tool_calls":[{"name":"read","arguments":{"path":3}}]}')],
  [result('{"content":"a","content":"b","tool_calls":[]}')],
  [{type:"result",ok:false,text:"authentication failed"}],
  [{type:"unknown"}],
 ];
 for(const responses of cases) await retryFixture(responses,async({config,model,context,count})=>{
  const events=[]; for await(const e of config.streamSimple(model,context,{})) events.push(e);
  assert.equal(events.at(-1).error.stopReason,"error"); assert.equal(count(),responses.length);
  assert.equal(events.filter(e=>e.type==="toolcall_end").length,0);
 });
 await retryFixture([result("invalid")],async({config,model,context,count})=>{
  assert.equal((await config.streamSimple(model,context,{}).result()).stopReason,"error"); assert.equal(count(),1);
 },1);
});
test("cancellation during format repair aborts without tool emission",{skip:process.platform==="win32"},async()=>{
 await retryFixture([result("invalid")],async({config,model,context,count})=>{
  const controller=new AbortController();
  const events=[];
  for await(const event of config.streamSimple(model,context,{signal:controller.signal})) {
   events.push(event);
   if(event.type==="thinking_delta" && event.delta.includes("再要求")) controller.abort();
  }
  assert.equal(events.at(-1).error.stopReason,"aborted");
  assert.equal(events.filter(e=>e.type==="toolcall_end").length,0);
 });
});

test("oversized malformed response is not partially sent for repair",{skip:process.platform==="win32"},async()=>{
 await retryFixture([result("x".repeat(65537))],async({config,model,context,count})=>{
  const answer=await config.streamSimple(model,context,{}).result();
  assert.equal(answer.stopReason,"error"); assert.equal(count(),1);
  assert.match(answer.errorMessage,/不正応答が大きすぎる/);
  assert.ok(!answer.errorMessage.includes("xxxxxxxx"));
 });
});

test("failed JSON previews only the final response in the interactive UI", {skip:process.platform==="win32"}, async()=>{
 const final = "最後の応答\u001b[31m\u202e " + "A".repeat(5000) + "tail";
 await retryFixture([result("直前の応答"),result(final)],async({config,model,context,notifications,count})=>{
  const answer = await config.streamSimple(model,context,{}).result();
  assert.equal(answer.stopReason,"error");
  assert.equal(count(),2);
  assert.equal(notifications.length,1);
  const [[preview, level]] = notifications;
  assert.equal(level,"error");
  assert.match(preview,/最後の応答/);
  assert.match(preview,/省略/);
  assert.ok(!preview.includes("直前の応答") && !preview.includes("tail"));
  assert.ok(!preview.includes("\u001b") && !preview.includes("\u202e"));
  assert.ok(!JSON.stringify(answer).includes("最後の応答"));
 });
});
