// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFixedProject} from '../タスクチーム/プロジェクト固定.mjs';
import profiles from '../デスクトップ/タスクチーム起動.cjs';
import {internalAuthorization} from '../タスクチーム/内部認証.mjs';

test('Task and Team duplicate identity includes canonical folder and startup mode',t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-project-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'other'));
 const profile=(kind,folder=root,fixed=false)=>profiles.taskTeamProfile(root,kind,folder,fixed);
 assert.equal(profile('task'),profile('task',join(root,'.')));
 assert.notEqual(profile('task'),profile('team'));
 assert.notEqual(profile('task'),profile('task',join(root,'other')));
 assert.notEqual(profile('task'),profile('task',root,true));
 assert.throws(()=>profile('task',join(root,'missing')));
 writeFileSync(join(root,'file'),'fixture');assert.throws(()=>profile('task',join(root,'file')));
});

test('internal reader fails closed for expired, malformed and remote credentials and rereads rotation',t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-auth-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 mkdirSync(join(root,'_config'));mkdirSync(join(root,'backend_server'));mkdirSync(join(root,'_AIDIY/backend_core'),{recursive:true});
 writeFileSync(join(root,'_config/AiDiy_key.json'),'{}');writeFileSync(join(root,'backend_server/core_main.py'),'# fixture');
 const file=join(root,'_AIDIY/backend_core/internal_auth.json');
 const reader=internalAuthorization('http://127.0.0.1:8091',[root]);
 const value={access_token:'fixture-valid-credential',token_type:'bearer',expires_at:new Date(Date.now()+60000).toISOString()};
 writeFileSync(file,JSON.stringify(value));assert.equal(reader().authorization,'Bearer '+value.access_token);
 value.access_token='fixture-rotated-credential';writeFileSync(file,JSON.stringify(value));assert.equal(reader().authorization,'Bearer '+value.access_token);
 assert.throws(()=>internalAuthorization('http://example.invalid:8091',[root])());
 value.expires_at='2000-01-01T00:00:00Z';writeFileSync(file,JSON.stringify(value));assert.throws(reader);
 writeFileSync(file,'{}');assert.throws(reader);
});
test('fixed project accepts existing canonical aliases and rejects changing or missing project',t=>{
 const root=mkdtempSync(join(tmpdir(),'aidiy-fixed-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));mkdirSync(join(root,'other'));
 const fixed=createFixedProject(root);
 for(const path of ['/task/タスク要求/登録','/task/タスク要求/AI登録','/task/タスク要求/更新登録','/team/依頼/登録','/team/依頼/変更']){
  assert.equal(fixed.validate(path,{プロジェクト:join(root,'.'),要求内容:'fixture'}).プロジェクト,fixed.path);
  for(const value of [undefined,'','../',join(root,'other'),join(root,'missing')])assert.throws(()=>fixed.validate(path,{プロジェクト:value}));
 }
 // 閲覧の検索条件はプロジェクト設定を変更しない。
 assert.deepEqual(fixed.validate('/team/依頼/一覧',{プロジェクト:''}),{プロジェクト:''});
});
