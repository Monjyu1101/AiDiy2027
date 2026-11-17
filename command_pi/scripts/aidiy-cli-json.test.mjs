import assert from "node:assert/strict";
import test from "node:test";
import { enginePrompt, extractJsonObject, parseInferenceAnswer } from "../aidiy/aidiy-cli-json.ts";
const tools = [{name:"read",description:"read",parameters:{type:"object",required:["path"],additionalProperties:false,properties:{path:{type:"string"}}}}];
test("Pi adds fixed JSON instructions and preserves outer input", () => {
 const prompt=enginePrompt({messages:[{role:"user",content:"hello"}],tools});
 assert.match(prompt,/単一の JSON/); assert.match(prompt,/最初の \{/); assert.match(prompt,/hello/);
});
test("Pi accepts wrapped/fenced fixed JSON and nested quoted braces", () => {
 for (const text of ['{"content":"hello","tool_calls":[]}', '説明\n```json\n{"content":"hello","tool_calls":[]}\n```\n完了']) {
  assert.deepEqual(parseInferenceAnswer(text,tools),{content:"hello",toolCalls:[]});
 }
 const call=parseInferenceAnswer('text\n{"content":"","tool_calls":[{"name":"read","arguments":{"path":"a} {b"}}]}\nend',tools).toolCalls[0];
 assert.equal(call.name,"read"); assert.equal(call.arguments.path,"a} {b"); assert.match(call.id,/^call_/);
});
test("Pi rejects duplicate, invalid or ambiguous objects without exposing response", () => {
 for(const text of ['missing', '{} {}', '{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"nested":{"x":1,"x":2}}', '{"x":NaN}', '{"x":1e999}', '{"x":', '{"x":1,}']) assert.throws(()=>extractJsonObject(text));
});
test("Pi validates own envelope and tool schema strictly", () => {
 for (const value of [
  {content:"",tool_calls:[]}, {content:"hi",tool_calls:[],extra:true}, {content:"hi"},
  {content:"",tool_calls:[{name:"shell",arguments:{path:"a"}}]},
  {content:"",tool_calls:[{name:"read",arguments:{path:3}}]},
  {content:"",tool_calls:[{name:"read",arguments:{path:"a",extra:true}}]},
  {content:"",tool_calls:[{name:"read",arguments:{}}]},
  {content:"",tool_calls:[{name:"read",arguments:[]}]},
 ]) assert.throws(()=>parseInferenceAnswer(JSON.stringify(value),tools));
});
