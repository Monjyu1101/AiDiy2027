// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 予測候補だけを絞り、通常Code候補を変更しない。実設定・APIは使わない。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {predictionModelsInfo, predictionModelSupported, HERMES_UNSUPPORTED_PREDICTION_ROUTES} from '../モデル情報/prediction_info.mjs';
const cases=JSON.parse(readFileSync(new URL('../../scripts/checks/prediction_route_cases.json',import.meta.url),'utf8'));
test('Hermes external CLI/ACP/AppServer routes are not prediction choices, API routes remain',()=>{
 for(const model of cases.rejected)assert.equal(predictionModelSupported('aidiy_hermes',model),false,model);
 for(const model of cases.allowed)assert.equal(predictionModelSupported('aidiy_hermes',model),true,model);
 assert.equal(predictionModelSupported('codex_cli','model'),true);
});
test('generated prediction catalog drops unsupported routes without changing Code catalog',async()=>{
 const models=Object.fromEntries([...cases.rejected,...cases.allowed,'auto','same'].map(model=>[model,model]));
 const codeModels={aidiy_hermes:{models},codex_cli:{models:{model:'model'}}};
 const before=JSON.stringify(codeModels);
 const result=await predictionModelsInfo([],{}, {configReader:async()=> '{}',codeModels});
 assert.deepEqual(Object.keys(result.aidiy_hermes.models),cases.allowed);
 assert.deepEqual(result.codex_cli.models,{model:'model'});
 assert.equal(JSON.stringify(codeModels),before);
 const empty=await predictionModelsInfo([],{}, {configReader:async()=> '{}',codeModels:{aidiy_hermes:{models:{'copilot_cli/same':'x'}}}});
 assert.equal(empty.aidiy_hermes,undefined);
});
test('Python stale-catalog filter uses the same route exclusions',()=>{
 const source=readFileSync(new URL('../../backend_tools/tools_proc/prediction_llm.py',import.meta.url),'utf8');
 const block=source.match(/HERMES_UNSUPPORTED_PREDICTION_ROUTES = frozenset\(\{([\s\S]*?)\}\)/)[1];
 assert.deepEqual([...block.matchAll(/"([^"]+)"/g)].map(match=>match[1]).sort(),[...HERMES_UNSUPPORTED_PREDICTION_ROUTES].sort());
});
