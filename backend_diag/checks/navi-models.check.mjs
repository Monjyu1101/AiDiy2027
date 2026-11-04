// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// プロバイダ別モデル情報（_AIDIY/aidiy_diag/<id>_models_info.json）の構成と保存。
import test from 'node:test';
import assert from 'node:assert/strict';
import {naviModelsInfo} from '../モデル情報/navi_info.mjs';
test('Navi候補は読取専用5方式、Hermes外部CLI転送を除外しCode原本不変',()=>{
 const code={aidiy_hermes:{models:{'openai_oauth/model':'OpenAI','copilot_cli/same':'CLI','claude-code:foo':'CLI','codex-cli/a':'CLI'}},copilot_cli:{models:{'claude-sonnet':'Claude'}},codex_cli:{models:{gpt:'GPT'}},claude_cli:{models:{sonnet:'Claude'}},grok_cli:{models:{grok:'Grok'}}};
 const before=JSON.stringify(code),out=naviModelsInfo(code,{now:()=>new Date('2026-11-04T00:00:00Z')});
 assert.deepEqual(Object.keys(out),['_meta','aidiy_hermes','copilot_cli','codex_cli','claude_cli','grok_cli']);
 assert.deepEqual(out.aidiy_hermes.models,{'openai_oauth/model':'OpenAI'});
 assert.deepEqual(out.copilot_cli,code.copilot_cli);assert.equal(JSON.stringify(code),before);assert.equal(out._meta.schema,1);
 assert.deepEqual(Object.keys(naviModelsInfo({})),['_meta']);
 assert.deepEqual(Object.keys(naviModelsInfo(code,{naviHermesAvailable:false})),['_meta','copilot_cli','codex_cli','claude_cli','grok_cli']);
});
