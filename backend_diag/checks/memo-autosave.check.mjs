// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE for full terms.
import test from 'node:test';import assert from 'node:assert/strict';
import {自動保存を作成} from '../memo/ui/src/自動保存.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const seed={id:'one.memo.json',保存先:'project:one',revision:'r1',タイトル:'題',本文:'最初',色:'yellow'};
function fixture(options={}){const calls=[];const api=async(route,{body})=>{calls.push({route,body});return {...body,id:body.id||'new.memo.json',revision:'r'+(calls.length+1)};};const model=自動保存を作成({api,sourceId:'project:one',clientId:'12345678-1234-4234-8234-123456789abc',delay:5,...options});return {model,calls};}
test('空新規は色・位置・サイズ変更やflushでも作成しない',async()=>{const {model,calls}=fixture();model.edit({色:'pink',位置:{x:-120,y:50},サイズ:{width:280,height:210},タイトル:' \n',本文:' \t'});await delay(15);assert.equal(await model.flush(),true);assert.equal(model.snapshot().blankNew,true);assert.equal(calls.length,0);model.dispose();});
test('タイトルだけでも1件作成し、以降は同じID/revisionで自動更新',async()=>{const {model,calls}=fixture();model.edit({タイトル:'タイトルのみ'});await model.flush();assert.equal(calls[0].route,'api/メモ/作成');assert.ok(calls[0].body.clientId);model.edit({本文:'内容'});await model.flush();assert.equal(calls.length,2);assert.equal(calls[1].route,'api/メモ/保存');assert.equal(calls[1].body.id,'new.memo.json');assert.equal(calls[1].body.revision,'r2');assert.equal(model.snapshot().dirty,false);model.dispose();});
test('保存中の入力・色・サイズを古いresponseで上書きせず後続保存する',async()=>{const calls=[];let release;const model=自動保存を作成({note:seed,api:async(route,{body})=>{calls.push(body);if(calls.length===1)await new Promise(resolve=>{release=resolve;});return {...body,revision:'r'+(calls.length+1)};},clientId:'test',sourceId:seed.保存先});model.edit({本文:'一番'});const pending=model.flush();await delay(0);model.edit({本文:'二番',色:'blue',サイズ:{width:500,height:300}});release();assert.equal(await pending,true);assert.equal(calls.length,2);assert.equal(calls[1].revision,'r2');assert.equal(calls[1].本文,'二番');assert.equal(model.snapshot().draft.本文,'二番');assert.equal(model.snapshot().draft.色,'blue');assert.equal(model.snapshot().dirty,false);model.dispose();});
test('既存の空内容は削除せず保存し、空新規の扱いにしない',async()=>{const {model,calls}=fixture({note:seed});model.edit({タイトル:'',本文:''});await model.flush();assert.equal(calls[0].route,'api/メモ/保存');assert.equal(calls[0].body.本文,'');assert.equal(model.snapshot().blankNew,false);model.dispose();});
test('競合はdraft/revision保持し、自動再送・無条件上書きをしない',async()=>{let count=0;const model=自動保存を作成({note:seed,clientId:'test',api:async()=>{count++;throw Object.assign(Error('競合'),{status:409});},delay:5});model.edit({本文:'ローカル'});assert.equal(await model.flush(),false);model.edit({本文:'追加'});await delay(20);assert.equal(count,1);assert.equal(model.snapshot().draft.本文,'追加');assert.equal(model.snapshot().conflict,true);assert.equal(await model.flush(),false);assert.equal(await model.retry(),false);assert.equal(count,2);model.dispose();});
test('create応答喪失後は同一clientIdと最初のsnapshotで確認し最新draftを追送',async()=>{const calls=[];let first=true;const model=自動保存を作成({sourceId:'project:one',clientId:'stable-id',api:async(route,{body})=>{calls.push({route,body});if(first){first=false;throw Error('通信切断');}return {...body,id:'created.memo.json',revision:'r'+calls.length};}});model.edit({本文:'最初'});assert.equal(await model.flush(),false);model.edit({本文:'追加した最新版'});assert.equal(await model.retry(),true);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[2].route,'api/メモ/保存');assert.equal(calls[2].body.本文,'追加した最新版');assert.equal(calls[2].body.revision,'r2');model.dispose();});
test('連続入力は150ms後にまとめ、close flushはtimerを待たず完了する',async()=>{const {model,calls}=fixture({delay:150});model.edit({本文:'a'});model.edit({本文:'ab'});await delay(30);assert.equal(calls.length,0);await model.flush();assert.equal(calls.length,1);assert.equal(calls[0].body.本文,'ab');await delay(170);assert.equal(calls.length,1);model.dispose();});
test('native再読込用callbackは成功したsnapshot全体を受ける',async()=>{const snapshots=[];let finish;let calls=0;const model=自動保存を作成({note:seed,clientId:'test',identity:value=>snapshots.push(value),api:async(_route,{body})=>{calls++;if(calls===1)await new Promise(resolve=>{finish=resolve;});return {...body,revision:'r'+(calls+1)};}});model.edit({本文:'先行'});const flight=model.flush();await delay(0);model.edit({本文:'後続'});finish();await flight;assert.equal(snapshots[0].本文,'先行');assert.equal(snapshots[1].本文,'後続');assert.equal(snapshots[1].revision,'r3');model.dispose();});
test('ゴミ箱は最新保存を待ち、終了flushと連打も削除完了を待つ',async()=>{
 const calls=[];let release;const model=自動保存を作成({note:seed,clientId:'test',api:async(route,{body})=>{
  calls.push({route,body});if(route.endsWith('/削除')){await new Promise(r=>{release=r});return {削除:true};}return {...body,revision:'latest'};
 }});
 model.edit({本文:'最終入力'});const pending=model.trash();await delay(0);
 assert.equal(model.trash(),pending);const closing=model.flush();let done=false;closing.then(()=>{done=true});
 await delay(0);assert.equal(done,false);assert.equal(calls[1].body.revision,'latest');
 release();assert.equal(await pending,true);assert.equal(await closing,true);
 model.edit({本文:'復活させない'});await model.flush();assert.equal(calls.length,2);assert.equal(model.snapshot().dirty,false);model.dispose();
});
test('空新規のゴミ箱はファイルを作らず、削除エラーは内容保持',async()=>{
 const blank=fixture();assert.equal(await blank.model.trash(),true);assert.equal(blank.calls.length,0);blank.model.dispose();
 const model=自動保存を作成({note:seed,clientId:'test',api:async()=>{throw Error('退避失敗')}});
 assert.equal(await model.trash(),false);assert.equal(model.snapshot().draft.本文,seed.本文);assert.match(model.snapshot().error,/退避失敗/);assert.equal(await model.flush(),false);model.dispose();
});
test('既定は内容・位置・サイズ・色の変更直後に保存開始、切替settledは追加保存しない',async()=>{
 const calls=[];const model=自動保存を作成({note:seed,sourceId:seed.保存先,api:async(_route,{body})=>{calls.push(body);return {...body,revision:'r'+calls.length};}});
 for(const patch of [{本文:'即時'},{位置:{x:40,y:80}},{サイズ:{width:300,height:250}},{色:'pink'}]){
  const before=calls.length;model.edit(patch);await Promise.resolve();assert.equal(calls.length,before+1);assert.equal(await model.settled(),true);
 }
 const count=calls.length;assert.equal(await model.settled(),true);assert.equal(calls.length,count);assert.ok(calls.every(body=>body.保存先===seed.保存先));model.dispose();
});
test('切替は既に始まった作成と後続保存を待つが、失敗・未開始保存を再送しない',async()=>{
 let release;const calls=[];const model=自動保存を作成({sourceId:seed.保存先,api:async(_route,{body})=>{calls.push(body);if(calls.length===1)await new Promise(resolve=>release=resolve);return {...body,id:'new.memo.json',revision:'r'+calls.length};}});
 model.edit({本文:'新規'});await Promise.resolve();model.edit({本文:'最新',位置:{x:5,y:6}});let done=false;const waiting=model.settled().then(ok=>{done=true;return ok;});await Promise.resolve();assert.equal(done,false);release();assert.equal(await waiting,true);assert.equal(calls.length,2);assert.equal(calls[1].本文,'最新');assert.ok(calls.every(body=>body.保存先===seed.保存先));model.dispose();
 const deferred=fixture({note:seed,delay:1000});deferred.model.edit({本文:'未開始'});assert.equal(await deferred.model.settled(),false);assert.equal(deferred.calls.length,0);deferred.model.dispose();
 let failedCalls=0;const failed=自動保存を作成({note:seed,api:async()=>{failedCalls++;throw Error('offline');}});failed.edit({本文:'保持'});assert.equal(await failed.settled(),false);assert.equal(await failed.settled(),false);assert.equal(failedCalls,1);assert.equal(failed.snapshot().draft.本文,'保持');failed.dispose();
});
