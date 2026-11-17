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
