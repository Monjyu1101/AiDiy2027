// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';
import assert from 'node:assert/strict';
import {メモキー, 編集開始, 変更あり, 保存要求} from '../memo/ui/src/メモ編集.mjs';
test('読み込み、編集、保存成功後の変更状態とrevision',()=>{
 const original={id:'a.memo.json',保存先:'source-opaque',タイトル:'一',本文:'改行\n日本語',色:'yellow',revision:'r1'};
 const note=編集開始(original);assert.equal(変更あり(note),false);
 note.本文+='変更';assert.equal(変更あり(note),true);
 assert.deepEqual(保存要求(note),{保存先:'source-opaque',id:'a.memo.json',revision:'r1',タイトル:'一',本文:'改行\n日本語変更',色:'yellow'});
 note.エラー='競合';assert.equal(変更あり(note),true);assert.equal(note.revision,'r1');
 const saved=編集開始({...保存要求(note),revision:'r2'});assert.equal(変更あり(saved),false);assert.equal(saved.revision,'r2');
});
test('同名メモは保存先ごとに識別し新規にはID/revisionを送らない',()=>{
 assert.notEqual(メモキー({id:'note.txt',保存先:'a'}),メモキー({id:'note.txt',保存先:'b'}));
 const note={...編集開始({id:'draft-1',保存先:'a',タイトル:'',本文:'',色:'yellow'}),新規:true};
 assert.equal(変更あり(note),true);assert.equal('id' in 保存要求(note),false);assert.equal('revision' in 保存要求(note),false);
});
test('タイトルと色の変更も未保存であり、元に戻すと解除する',()=>{
 const note=編集開始({タイトル:'題',本文:'文',色:'blue'});note.色='pink';assert.equal(変更あり(note),true);note.色='blue';note.タイトル='別';assert.equal(変更あり(note),true);note.タイトル='題';assert.equal(変更あり(note),false);
});
test('位置・サイズも未保存に含めて保存し、textのsidecar用にも渡す',()=>{
 const note=編集開始({id:'memo.txt',形式:'text',保存先:'opaque',タイトル:'memo',本文:'文',色:'blue',位置:{x:10,y:20},サイズ:{width:260,height:280},revision:'r1'});
 assert.equal(変更あり(note),false);note.位置={x:60,y:40};assert.equal(変更あり(note),true);note.サイズ={width:310,height:320};
 const body=保存要求(note);assert.deepEqual(body.位置,{x:60,y:40});assert.deepEqual(body.サイズ,{width:310,height:320});
 const saved=編集開始({...note,...body,revision:'r2'});assert.equal(変更あり(saved),false);
});
