// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),{transformSync}=require('esbuild'),vue=require('vue');
function moduleFrom(path,dependencies={}){
 const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(new URL(path,import.meta.url),'utf8'),{format:'cjs',loader:path.endsWith('.ts')?'ts':'js'}).code,{module,atob,btoa,Uint8Array,console,require:name=>dependencies[name]});return module.exports;
}
const shared=moduleFrom('../host/src/file-attachments.ts');
const {readDroppedFiles}=moduleFrom('../src/components/添付ファイル/ファイル送信.js',{'../../../host/src/file-attachments':shared});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6EJAAAAAASUVORK5CYII=';
const packet=(kind='input_file',extra={})=>({セッションID:'session-a',チャンネル:'1',メッセージ識別:kind,ファイル名:'temp/input/stamp.uuid.資料.png',元ファイル名:'資料.png',サムネイル画像:png,...extra});
const file=(name='資料.txt',text='fixture')=>({name,size:Buffer.byteLength(text),arrayBuffer:async()=>Uint8Array.from(Buffer.from(text)).buffer});

test('添付: 送信データは4MiBまで、名前とbase64をNode/renderer共通で検証',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(shared.validateFileUpload({name:'資料.txt',base64:'YWJj'}))),{name:'資料.txt',base64:'YWJj'});
 for(const name of ['','..','../a','a/b','C:\\a','a\0b','a\nb','a'.repeat(256)])assert.throws(()=>shared.validateFileUpload({name,base64:'YWJj'}));
 for(const base64 of ['', 'a','aaaa===','data:text/plain;base64,YWJj','YW Jj','____'])assert.throws(()=>shared.validateFileUpload({name:'test.txt',base64}));
 const limit=Buffer.alloc(shared.MAX_FILE_BYTES).toString('base64');assert.equal(shared.validateFileUpload({name:'limit.bin',base64:limit}).base64,limit);
 assert.throws(()=>shared.validateFileUpload({name:'large.bin',base64:Buffer.alloc(shared.MAX_FILE_BYTES+1).toString('base64')}));
});

test('添付: CorePNGだけを表示、URL/SVG/偽画像/過大サムネイルや寸法は拒否',()=>{
 assert.equal(shared.safeThumbnail(png),'data:image/png;base64,'+png);
 assert.equal(shared.safeThumbnail('data:image/png;base64,'+png),'data:image/png;base64,'+png);
 for(const value of ['https://example.test/tracker.png','file:///private.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,'+png,'PHNjcmlwdD4=',null,Buffer.alloc(shared.MAX_THUMBNAIL_BYTES+1).toString('base64')])assert.equal(shared.safeThumbnail(value),'');
 for(const [width,height]of [[0,1],[8193,1],[5000,5000]]){const bytes=Buffer.from(png,'base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);assert.equal(shared.safeThumbnail(bytes.toString('base64')),'');}
});

test('添付: 入力echo/AI出力は同session/channel限定、元名保持と重複キーを共用',()=>{
 const input=shared.fileAttachment(packet(),'session-a','1'),output=shared.fileAttachment(packet('output_file'),'session-a','1');
 assert.equal(input.name,'資料.png');assert.equal(input.path,'temp/input/stamp.uuid.資料.png');assert.notEqual(input.key,output.key);
 assert.equal(input.key,shared.fileAttachment(packet(),'session-a','1').key);
 assert.equal(shared.fileAttachment(packet('output_file',{チャンネル:undefined}),'session-a','1').kind,'output_file','Coreの出力socketが補う省略channelは許可');
 for(const changed of [{セッションID:'session-b'},{セッションID:undefined},{チャンネル:'0'},{メッセージ識別:'output_text'},{ファイル名:'javascript:alert(1)'},{ファイル名:'file:/private.png'},{ファイル名:'mailto:test@example.test'},{ファイル名:'https://example.test/x'},{ファイル名:'temp/input/../x'},{ファイル名:'a\0b'}])assert.equal(shared.fileAttachment(packet('input_file',changed),'session-a','1'),undefined);
 assert.equal(shared.fileAttachment(packet('output_file',{ファイル名:'C:\\temp\\output\\image.png'}),'session-a','1').path,'C:\\temp\\output\\image.png');
 const document=shared.fileAttachment(packet('output_file',{ファイル名:'temp/output/report.pdf',元ファイル名:undefined,メッセージ内容:'ファイル出力: report.pdf',サムネイル画像:null}),'session-a','1');
 assert.equal(document.name,'report.pdf');assert.equal(document.thumbnail,'');
});

test('添付: 同pathの出力更新は版ごとに表示、重複と版なしCore履歴replayは除く',()=>{
 const first=shared.fileAttachment(packet('output_file',{ファイル版:'a'.repeat(64)}),'session-a','1');
 const next=shared.fileAttachment(packet('output_file',{ファイル版:'b'.repeat(64)}),'session-a','1');
 const legacy=shared.fileAttachment(packet('output_file'),'session-a','1');
 assert.notEqual(first.key,next.key);assert.equal(first.revision,'a'.repeat(64));
 assert.equal(shared.isDuplicateAttachment(first,first),true);
 assert.equal(shared.isDuplicateAttachment(first,next),false);
 assert.equal(shared.isDuplicateAttachment(first,legacy),true);
 assert.equal(shared.isDuplicateAttachment(legacy,{...legacy,thumbnail:'別のプレビュー'}),false,'版なし旧Coreでも画像更新を捨てない');
 assert.equal(shared.isDuplicateAttachment(first,{...legacy,path:'other.png'}),false);
 assert.equal(shared.isDuplicateAttachment(first,{...legacy,session:'other'}),false);
 assert.equal(shared.isDuplicateAttachment(first,{...legacy,thumbnail:''}),false);
 assert.equal(shared.fileAttachment(packet('output_file',{ファイル版:'untrusted'}),'session-a','1').revision,undefined);
 assert.equal(shared.fileAttachment(packet('input_file',{ファイル版:'a'.repeat(64)}),'session-a','1').revision,undefined);
});

test('添付D&D: 全件事前検証、順番に一度だけ送信し元ファイル名を維持',async()=>{
 const sent=[];const count=await readDroppedFiles([file('a.txt','one'),file('資料.txt','two')],{isCurrent:()=>true,onFile:async value=>{sent.push(value);}});
 assert.equal(count,2);assert.deepEqual(sent.map(f=>f.name),['a.txt','資料.txt']);assert.deepEqual(sent.map(f=>Buffer.from(f.base64,'base64').toString()),['one','two']);
 const options={isCurrent:()=>true,onFile:async()=>assert.fail('検証失敗時は送信しない')};
 await assert.rejects(readDroppedFiles([file(),{...file(),size:shared.MAX_FILE_BYTES+1}],options),/4 MiB/);
 await assert.rejects(readDroppedFiles(Array.from({length:11},()=>file()),options),/10件/);
 await assert.rejects(readDroppedFiles([file(),file('../bad')],options),/ファイル名/);
 assert.equal(await readDroppedFiles([],options),0);
});

test('添付D&D: 読込中の接続/会話変更、読込失敗、サイズ変化で送信せず自動再送しない',async()=>{
 let current=true,send=0;const options={isCurrent:()=>current,onFile:async()=>{send++;}};
 const changing={...file(),arrayBuffer:async()=>{current=false;return Uint8Array.from(Buffer.from('fixture')).buffer;}};
 await assert.rejects(readDroppedFiles([changing],options),/会話が変わった/);assert.equal(send,0);
 current=true;await assert.rejects(readDroppedFiles([{...file(),arrayBuffer:async()=>{throw Error('disk failed');}}],options),/disk failed/);assert.equal(send,0);
 await assert.rejects(readDroppedFiles([{...file(),size:1}],options),/サイズが読込中/);assert.equal(send,0);
 await assert.rejects(readDroppedFiles([file(),file()],{isCurrent:()=>true,onFile:async()=>{send++;throw Error('offline');}}),/offline/);assert.equal(send,1);
});

test('添付D&D: 第1件後の送信先変更や明示送信拒否で残りを止める',async()=>{
 let current=true,sent=0;
 await assert.rejects(readDroppedFiles([file(),file()],{isCurrent:()=>current,onFile:async()=>{sent++;current=false;}}),/会話が変わった/);assert.equal(sent,1);
 await assert.rejects(readDroppedFiles([file()],{isCurrent:()=>true,onFile:async()=>false}),/送信できません/);
});

function component(attachment){
 const {parse,compileScript,compileTemplate}=require('@vue/compiler-sfc');
 const {descriptor}=parse(readFileSync(new URL('../src/components/添付ファイル/チャット添付.vue',import.meta.url),'utf8'));
 const script=compileScript(descriptor,{id:'chat-file',genDefaultAs:'component'}),template=compileTemplate({source:descriptor.template.content,filename:'ChatFile.vue',id:'chat-file',compilerOptions:{bindingMetadata:script.bindings}});
 assert.deepEqual(template.errors,[]);const module={exports:{}};
 vm.runInNewContext(transformSync(script.content+'\n'+template.code+'\ncomponent.render=render;module.exports=component;',{format:'cjs'}).code,{module,console,require:name=>name==='vue'?vue:name==='../../../host/src/file-attachments'?shared:{}});
 const props={attachment},scope=vue.effectScope(),state=scope.run(()=>module.exports.setup(props,{expose(){}}));
 return{state,render:()=>module.exports.render({},[],props,vue.proxyRefs(state),{},{}),dispose:()=>scope.stop()};
}

test('添付UI: boomerangとAI生成画像はinline画像、拡大もローカルdataのみ',()=>{
 for(const kind of ['input_file','output_file']){
  const value=shared.fileAttachment(packet(kind),'session-a','1'),f=component(value);
  try{const node=f.render(),button=node.children[2];assert.equal(button.type,'button');assert.equal(button.children[0].props.src,'data:image/png;base64,'+png);button.props.onClick({stopPropagation(){}});assert.equal(f.state.enlarged.value,true);assert.equal(f.render().children[3].props.label,'資料.pngの画像');}finally{f.dispose();}
 }
});

test('添付UI: 非画像/不正画像はテキストのみ、ファイル/外部URLへ遷移しない',()=>{
 for(const thumbnail of ['', 'https://example.test/image.png','data:image/svg+xml;base64,PHN2Zy8+']){
  const f=component({...shared.fileAttachment(packet(),'session-a','1'),thumbnail,name:'<img src=x onerror=alert(1)>',path:'file:///private'});
  try{const tree=f.render();assert.equal(tree.children[2].type,'span');assert.equal(tree.children[2].props.href,undefined);assert.equal(f.state.image.value,'');}finally{f.dispose();}
 }
});
