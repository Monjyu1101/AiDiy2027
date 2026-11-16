import assert from "node:assert/strict";
import test from "node:test";
import { chatPayload, parseChatAnswer } from "../aidiy/aidiy-cli-chat.ts";

test("preserves outer tool call IDs, arguments and results", () => {
 const data = chatPayload([
  {role:"user", content:"read it"},
  {role:"assistant", content:[{type:"toolCall", id:"call_1", name:"read", arguments:{path:"a"}}]},
  {role:"toolResult", toolCallId:"call_1", content:[{type:"text",text:"file data"}], isError:false},
 ], "parent system", [{name:"read",description:"read file",parameters:{type:"object"}}]);
 assert.equal(data.messages[0].content,"parent system");
 assert.equal(data.messages[2].tool_calls[0].id,"call_1");
 assert.deepEqual(JSON.parse(data.messages[2].tool_calls[0].function.arguments),{path:"a"});
 assert.equal(data.messages[3].tool_call_id,"call_1");
 assert.equal(data.messages[3].content,"file data");
 assert.equal(data.tools[0].function.name,"read");
});
test("structured tool request becomes Pi native toolCall, text-only is supported", () => {
 const answer = parseChatAnswer({role:"assistant",content:null,tool_calls:[{id:"id",type:"function",function:{name:"read",arguments:'{"path":"a"}'}}]},["read"]);
 assert.deepEqual(answer.toolCalls,[{type:"toolCall",id:"id",name:"read",arguments:{path:"a"}}]);
 assert.deepEqual(parseChatAnswer({role:"assistant",content:"done"},[]),{content:"done",toolCalls:[]});
});
test("invalid or unavailable tools and duplicate calls fail closed", () => {
 const call = {id:"id",type:"function",function:{name:"read",arguments:'{}'}};
 for (const message of [
 {role:"assistant",content:null,tool_calls:[call]},
 {role:"assistant",content:null,tool_calls:[call,call]},
 {role:"assistant",content:null,tool_calls:[{...call,function:{name:"read",arguments:"[]"}}]},
 {role:"assistant",content:null,tool_calls:[{...call,function:{name:"read",arguments:"not json"}}]},
 {role:"assistant",content:""},
 ]) assert.throws(()=>parseChatAnswer(message,message.tool_calls?.length===1 && message.tool_calls[0]===call ? [] : ["read"]));
});
test("image input fails rather than dropping context; tool errors remain visible", () => {
 assert.throws(()=>chatPayload([{role:"user",content:[{type:"image",data:"a",mimeType:"image/png"}]}],"",[]));
 assert.match(chatPayload([{role:"toolResult",toolCallId:"x",content:[{type:"text",text:"bad"}],isError:true}],"",[]).messages[1].content,/tool error/);
});
