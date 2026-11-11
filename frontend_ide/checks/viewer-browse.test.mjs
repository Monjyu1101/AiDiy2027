// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFilePath,describeSelectedFile} from '../src/components/ファイル閲覧/選択ファイル.js';
test('選択した実パスだけプロジェクト相対パスへ変換する',()=>{
 assert.equal(projectFilePath('/project','/project/sub/a.txt'),'sub/a.txt');
 assert.equal(projectFilePath('C:\\Project','c:\\project\\sub\\a.txt'),'sub/a.txt');
 for(const full of ['/project2/a.txt','/outside/a.txt','/project/../secret','/project'])assert.equal(projectFilePath('/project',full),null);
 assert.equal(projectFilePath('/project',''),null);
});
test('明示選択したFileを上限内で分類・表示する',async()=>{
 assert.equal((await describeSelectedFile(new File(['日本語'],'a.txt'))).text,'日本語');
 assert.equal((await describeSelectedFile(new File([new Uint8Array([0,1])],'a.bin'))).kind,'binary');
 assert.equal((await describeSelectedFile(new File(['image'],'a.png'))).kind,'image');
 assert.equal((await describeSelectedFile(new File(['document'],'a.pdf'))).format,'pdf');
 assert.equal((await describeSelectedFile(new File(['sound'],'a.mp3'))).kind,'media');
 assert.equal((await describeSelectedFile({name:'a.pdf',size:51*1024*1024})).tooLarge,true);
 const large=new File(['x'.repeat(1024*1024+10)],'large.txt');
 const value=await describeSelectedFile(large);assert.equal(value.truncated,true);assert.equal(value.text.length,1024*1024);
});
