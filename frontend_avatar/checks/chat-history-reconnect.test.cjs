// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 再接続時の welcome_info → 履歴 → welcome_text を実ハンドラへ流す。
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const {parse} = require('../node_modules/@vue/compiler-sfc');

for (const root of ['../src/components','../../frontend_web/src/components/AiDiy/compornents']) {
for (const [file, welcome] of [['AIチャット.vue','ウェルカム受信処理'],['AIコード.vue','ウェルカム処理']]) {
  test(`${root}/${file}: 再接続の履歴は置換し、同じ文の別の発言は維持する`, () => {
    const source = parse(fs.readFileSync(path.join(__dirname,root,file),'utf8')).descriptor.scriptSetup.content;
    const ast = ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const names = new Set([welcome,'受信内容文字列','受信チャンネル一致','入力テキスト受信処理','出力テキスト受信処理','ウェルカムテキスト受信処理','表示時アクティブ化']);
    const body = ast.statements.filter(n => names.has(n.name?.text) || (ts.isVariableStatement(n) && n.declarationList.declarations.some(d=>names.has(d.name.text)))).map(n=>n.getText(ast)).join('\n');
    const rows={value:[]}, ready={value:false}, effects=new Map(), cleared=[], activated=[];
    const context={メッセージ一覧:rows,ウェルカムテキスト受信済み:ready,演出状態Map:effects,
      ウェルカム内容:{value:''},ウェルカム表示有無:{value:false},送信中:{value:false},ストリームメッセージID:null,プロパティ:{チャンネル:'0'},
      clearInterval:id=>cleared.push(id),通知:event=>activated.push(event),console:{log(){}},
      ターミナルメッセージ追加:(role,text)=>rows.value.push({role,text})};
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(body,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText+`
      globalThis.receive = (type, text, channel='0') => {
        const message={メッセージ内容:text,チャンネル:channel};
        if(type==='welcome') ${welcome}(message);
        if(type==='input') 入力テキスト受信処理(message);
        if(type==='output') 出力テキスト受信処理(message);
        if(type==='ready') ウェルカムテキスト受信処理(message);
      };`,context);
    for(let cycle=0;cycle<3;cycle++) {
      effects.set('old',{blinkInterval:cycle});
      context.receive('welcome','会話情報');
      assert.equal(rows.value.length,0);
      assert.equal(effects.size,0);
      assert.equal(ready.value,false);
      context.receive('input','おはよう');
      context.receive('output','おはようございます');
      context.receive('input','おはよう');
      context.receive('ready','準備できました');
      assert.equal(rows.value.length,4,'再接続で履歴を積み重ねない');
      assert.equal(rows.value.filter(r=>r.role==='input_text').length,2,'同文の別発言を削除しない');
      assert.equal(activated.length,0,'履歴復元で利用中のタブを奪わない');
    }
    context.receive('output','新しい返答');
    assert.equal(rows.value.length,5);
    assert.deepEqual(activated,['activate'],'新しい返答では通常の通知を維持する');
    assert.deepEqual(cleared,[0,1,2]);
  });
}
}

test('Web: Code5・6の表示変更を監視し、再接続用の状態に含める', () => {
  const file=path.join(__dirname,'../../frontend_web/src/components/AiDiy/AiDiy.vue');
  const source=parse(fs.readFileSync(file,'utf8')).descriptor.scriptSetup.content;
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const get=ast.statements.find(n=>n.name?.text==='ボタン状態取得').getText(ast);
  const watches=ast.statements.filter(n=>ts.isExpressionStatement(n)&&ts.isCallExpression(n.expression)&&n.expression.expression.getText(ast)==='watch');
  const watched=watches.find(n=>n.expression.arguments[0].getText(ast).includes('パネルボタン状態')).expression.arguments[0].getText(ast);
  const flags={file:false,chat:true,image:false,code1:false,code2:false,code3:false,code4:false,code5:true,code6:true};
  const context={パネルボタン状態:{value:flags},チャットモード:{value:'chat'}};
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(get+`;globalThis.saved=ボタン状態取得;globalThis.watched=${watched};`,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText,context);
  for (const state of [true,false,true]) {
    flags.code5=state;flags.code6=state;
    for (const result of [context.saved(),context.watched()]) {
      assert.equal(result.エージェント5,state);
      assert.equal(result.エージェント6,state);
    }
  }
});
