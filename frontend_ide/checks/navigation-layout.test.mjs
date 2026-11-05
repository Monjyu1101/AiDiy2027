// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse,compileTemplate} from '@vue/compiler-sfc';
import {baseParse} from '@vue/compiler-dom';
const source=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
const {descriptor,errors}=parse(source);
const compiled=compileTemplate({source:descriptor.template.content,filename:'Navigationパネル.vue',id:'navi-layout'});
const attr=(node,name)=>node.props?.find(prop=>prop.type===6&&prop.name===name)?.value?.content;
const hasClass=(node,name)=>attr(node,'class')?.split(' ').includes(name);
const elements=node=>(node.children||[]).filter(child=>child.type===1);
test('総合評価・おすすめプロンプトを明細スクロール外に順序どおり固定する',()=>{
 assert.deepEqual(errors,[]);assert.deepEqual(compiled.errors,[]);
 const panel=elements(baseParse(descriptor.template.content))[0],children=elements(panel);
 const positions=['navigation-display','navigation-overall','navigation-next'].map(name=>children.findIndex(node=>hasClass(node,name)));
 assert.ok(positions.every(index=>index>=0));assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
 const overall=children[positions[1]],next=children[positions[2]];
 assert.equal(overall.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'result&&!history');assert.equal(next.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'autopilot||(result&&!history)');
 assert.match(source,/\.navigation-panel>\.navigation-overall\{flex:none;/);
 assert.match(source,/\.navigation-overall>\.navigation-disclosure\{min-height:0;overflow:auto\}/);
 assert.match(source,/>目標<small/);assert.doesNotMatch(descriptor.template.content,/未評価|>開発目標<\/label>/);
 assert.match(source,/:aria-valuenow="overall.progress"/);assert.match(source,/:aria-valuenow="item.progress"/);
});

const walk=node=>[node,...(node.children||[]).flatMap(walk)];
test('タイトルのCode切替は表示・非表示とも四角い枠を持ち、窓操作の枠なし指定に負けない',()=>{
 const css=descriptor.styles.map(style=>style.content).join('\n');
 const shared=css.match(/\.navigation-code-toggle,\.window-actions \.navigation-code-toggle\{([^}]+)\}/)?.[1];assert.ok(shared);
 assert.match(shared,/(?:^|;)border:1px solid #[\da-f]{6}(?:;|$)/i);assert.match(shared,/(?:^|;)border-radius:0(?:;|$)/);
 assert.match(css,/\.navigation-code-toggle\[aria-checked="true"\]\{border-color:#7de2cf\}/);
 const toggles=walk(baseParse(descriptor.template.content)).filter(node=>hasClass(node,'navigation-code-toggle'));assert.equal(toggles.length,3);
 for(const toggle of toggles){assert.equal(toggle.tag,'button');assert.equal(attr(toggle,'role'),'switch');assert.equal(toggle.props.find(p=>p.type===7&&p.arg?.content==='aria-checked').exp.content,'codeOpen');assert.equal(toggle.props.find(p=>p.type===7&&p.name==='on'&&p.arg?.content==='click').exp.content,'toggleCode');}
});

test('Navigator専用Codeは重複タイトルと接続線だけを省略し、共通AiDiy画像を指定する',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),code=nodes.find(node=>node.tag==='CodePanel');assert.ok(code);
 assert.equal(attr(code,'icon'),'/development/AiDiy.png');assert.ok(code.props.some(prop=>prop.type===6&&prop.name==='hide-status-bar'));
 const aside=nodes.find(node=>hasClass(node,'navigation-code'));assert.equal(elements(aside).some(node=>node.tag==='header'||node.tag==='button'),false);
});

test('Navigatorの制御説明は専用Codeだけへ指定し、従来の上部説明を重複させない',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),aside=nodes.find(node=>hasClass(node,'navigation-code')),code=walk(aside).find(node=>node.tag==='CodePanel');
 assert.equal(attr(code,'project-notice'),'Navigator制御下です。自動航行オンならここで実行し、完了後に再評価します。評価が3回改善しない場合は停止します。');
 assert.equal(elements(aside).some(node=>node.tag==='small'),false);assert.doesNotMatch(source,/このNavigator専用です。/);
 assert.equal((source.match(/Navigator制御下です。/g)||[]).length,1);
});

test('共通の確認日時をタスク見出しに1つだけ表示し、各行や不明日時を捏造しない',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),items=nodes.find(node=>hasClass(node,'navigation-items')),heading=nodes.find(node=>hasClass(node,'navigation-task-heading'));
 assert.equal(heading.tag,'h2');assert.equal(heading.children[0].content,'タスク');assert.equal(walk(items).filter(node=>hasClass(node,'navigation-checked-at')).length,0);
 const [time,unknown]=elements(heading);assert.equal(time.tag,'time');assert.equal(time.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'checkedAt');assert.equal(time.props.find(prop=>prop.type===7&&prop.arg?.content==='datetime').exp.content,'checkedAt.iso');
 assert.match(time.children[0].content,/\(/);assert.equal(time.children[1].content.content,'checkedAt.text');assert.match(time.children[2].content,/\)/);assert.match(unknown.children[0].content,/確認日時不明/);
 assert.match(attr(time,'title'),/AI評価結果の確定日時/);assert.equal(nodes.filter(node=>node.tag==='time'&&hasClass(node,'navigation-checked-at')).length,1);assert.equal(walk(items).filter(node=>attr(node,'role')==='progressbar').length,1);
});

test('明細と総合の理由は独立したネイティブ開閉で、初期は折りたたむ',()=>{
 const nodes=walk(baseParse(descriptor.template.content));
 const disclosures=nodes.filter(node=>node.tag==='details');
 assert.equal(disclosures.length,2);
 for(const details of disclosures){
  assert.equal(hasClass(details,'navigation-disclosure'),true);
  assert.ok(details.props.every(prop=>!['open','name'].includes(prop.name)));
  const [summary,reasons]=elements(details);
  assert.equal(summary.tag,'summary');assert.equal(hasClass(reasons,'navigation-reasons'),true);
  assert.ok(summary.props.every(prop=>!['role','tabindex'].includes(prop.name)));
  const arrow=walk(summary).find(node=>hasClass(node,'navigation-disclosure-arrow'));
  assert.equal(attr(arrow,'aria-hidden'),'true');
  assert.ok(walk(summary).some(node=>attr(node,'role')==='progressbar'));
 }
 assert.match(source,/content:'▶'/);assert.match(source,/\[open\]>summary .*content:'▽'/);
 assert.match(source,/>summary:focus-visible/);
 assert.equal((source.match(/:key="result.navigationId\|\|result.requestId"/g)||[]).length,2);
});

test('おすすめプロンプトはAI本文をそのまま表示し機械的な説明を付けない',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),section=nodes.find(node=>hasClass(node,'navigation-next'));
 assert.equal(attr(section,'aria-label'),'プロンプト(案)');
 const heading=walk(section).find(node=>node.tag==='h2');assert.equal(heading.children[0].content,'プロンプト(案)');
 const prompt=walk(section).find(node=>hasClass(node,'navigation-prompt'));
 const body=elements(prompt)[0];assert.equal(body.children[0].content.content,'recommendedPrompt');
 assert.equal(body.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'nextItem');
 assert.doesNotMatch(descriptor.template.content,/navigation-purpose|navigation-target|次の一歩/);
 assert.match(source,/clipboard\.writeText\(text\)/);
 assert.doesNotMatch(descriptor.template.content,/プロンプト案です。/);
 const alert=walk(section).find(node=>hasClass(node,'navigation-copy-error'));assert.equal(attr(alert,'role'),'alert');
});

test('CODE/LIVEへは見出しのすぐ右に置き同じ窓内の共通ダイアログで選択する',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),row=nodes.find(node=>hasClass(node,'navigation-prompt-actions'));
 const children=elements(row);assert.equal(children[0].tag,'h2');assert.equal(children[1].children[0].content,'CODE/LIVEへ');
 assert.equal(children[1].props.find(p=>p.type===7&&p.name==='if').exp.content,'nextItem');
 const dialog=nodes.find(node=>node.tag==='DraftHandoffDialog');assert.ok(dialog);assert.match(source,/:insert-draft="draftActions.insertDraft"/);assert.match(source,/:load-targets="draftActions.loadTargets"/);
 assert.doesNotMatch(source,/postMessage|BroadcastChannel|localStorage/);
});

test('明細項目と総合評価の枠はスクエアで、パネル外枠は変更しない',()=>{
 const css=descriptor.styles.map(style=>style.content).join('\n');
 const rules=selector=>[...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match=>match[1].trim()===selector).map(match=>match[2]);
 for(const selector of ['.navigation-items li','.navigation-progress','.navigation-items .navigation-progress']){
  const radii=rules(selector).flatMap(rule=>[...rule.matchAll(/(?:^|;)border-radius:([^;]+)/g)].map(match=>match[1]));assert.ok(radii.length);assert.ok(radii.every(radius=>radius==='0'));
 }
 const nodes=walk(baseParse(descriptor.template.content)),overall=nodes.find(node=>hasClass(node,'navigation-overall'));
 assert.ok(walk(overall).some(node=>hasClass(node,'navigation-progress')));
 assert.match(rules('.navigation-panel').join(''),/border-radius:10px/);
});


test('目標入力とおすすめ本文は同じ角丸なしの背景・枠・文字を使い、本文は閲覧専用',()=>{
 const css=descriptor.styles.map(style=>style.content).join('\n');
 const shared=css.match(/\.navigation-goal-form textarea,\.navigation-panel>\.navigation-next \.navigation-prompt\{([^}]+)\}/)?.[1];assert.ok(shared);
 for(const value of ['background:#000','color:#edf5ff','border:1px solid #454545','border-radius:0','padding:10px','font:inherit','line-height:1.5'])assert.ok(shared.includes(value),value);
 const nodes=walk(baseParse(descriptor.template.content)),prompt=nodes.find(node=>hasClass(node,'navigation-prompt'));
 assert.equal(prompt.tag,'p');assert.equal(attr(prompt,'contenteditable'),undefined);
 assert.ok(nodes.some(node=>node.tag==='textarea'&&node.props.some(p=>p.type===7&&p.name==='model'&&p.exp.content==='goal')));
 assert.match(css,/\.navigation-panel>\.navigation-next \.navigation-prompt\{[^}]*overflow:auto/);
 assert.match(css,/\.navigation-prompt\{[^}]*white-space:pre-wrap[^}]*user-select:text/);
});


test('目標は4行、左の説明・目標差異・モデル3段の右に同サイズのナビ・再評価を置く',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),form=nodes.find(node=>hasClass(node,'navigation-goal-form')),children=elements(form);
 const textarea=children.find(node=>node.tag==='textarea');assert.equal(attr(textarea,'rows'),'4');
 const row=children.find(node=>hasClass(node,'navigation-form-foot'));assert.ok(row);
 const controls=elements(row);assert.ok(hasClass(controls[0],'navigation-input-meta'));assert.ok(hasClass(controls[1],'navigation-run-actions'));
 const meta=elements(controls[0]);assert.ok(hasClass(meta[0],'navigation-input-hint'));assert.ok(hasClass(meta[1],'navigation-draft-note'));assert.ok(hasClass(meta[2],'navigation-model-line'));
 assert.equal(meta[1].props.find(p=>p.type===7&&p.name==='if').exp.content,'result&&!matchesResult');assert.equal(attr(meta[1],'role'),'status');
 assert.equal(nodes.filter(node=>hasClass(node,'navigation-draft-note')).length,1);assert.ok(!children.some(node=>hasClass(node,'navigation-draft-note')));
 const [navi,evaluate]=elements(controls[1]);assert.ok(hasClass(navi,'navigation-run')&&hasClass(evaluate,'navigation-run'));assert.equal(elements(navi)[0].props.find(p=>p.type===7&&p.name==='bind'&&p.arg?.content==='src').exp.content,'sendIcon');assert.equal(evaluate.children[0].content,'再評価');
 assert.equal(navi.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content,'busy||autopilot||!availability.available');assert.equal(evaluate.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content,'!canEvaluate||autopilot');
 assert.doesNotMatch(descriptor.template.content,/navigation-model-footer/);
 assert.match(source,/grid-template-columns:minmax\(0,1fr\) auto/);assert.match(source,/width:40\.6px;height:40\.6px/);assert.match(source,/\.navigation-form-foot \.navigation-model-line\{min-width:0;flex-wrap:wrap/);
});


test('送信アイコンはCode同様の実行時URLで参照しViteの静的画像importを作らない',()=>{
 assert.match(source,/const sendIcon=computed\(\(\)=>new URL\('sending.png',new URL\('\/development\/AiDiy.png',location.href\)\).href\)/);
 assert.doesNotMatch(compiled.code,/import[^\n]*sending\.png/);
 assert.doesNotMatch(descriptor.template.content,/(?<!:)src="\/development\/sending\.png"/);
});


test('ナビの手紙は大きく、文字を重ねても同サイズのボタンと文字の読みやすさを保つ',()=>{
 assert.match(source,/\.navigation-run img\{position:absolute;inset:2px;width:35px;height:35px/);
 assert.match(source,/\.navigation-button-label\{position:relative;z-index:1;[^}]*font-weight:700;[^}]*background:/);
 assert.match(source,/\.navigation-input-meta\{display:flex;flex-direction:column;gap:6px;min-width:0/);
 assert.match(source,/\.navigation-input-hint\{[^}]*overflow-wrap:anywhere/);
 assert.match(source,/\.navigation-draft-note\{[^}]*margin:0;overflow-wrap:anywhere/);
});

test('自動航行中の総合評価は周回枠と枠内下部中央の状態を表示し、再評価中も表示する',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),overall=nodes.find(node=>hasClass(node,'navigation-overall'));
 assert.equal(overall.props.find(p=>p.type===7&&p.name==='show').exp.content,'!routing||codeDriving');
 assert.equal(overall.props.find(p=>p.type===7&&p.arg?.content==='class').exp.content,'{driving:codeDriving}');
 const [details,status]=elements(overall);assert.equal(details.tag,'details');assert.equal(hasClass(status,'navigation-overall-cruise-status'),true);assert.equal(status.props.find(p=>p.type===7&&p.name==='if').exp.content,'codeDriving');assert.equal(status.children[0].content,'自動航行中');assert.equal(attr(status,'role'),'status');
 assert.match(source,/\.navigation-code\.driving,\.navigation-panel>\.navigation-overall\.driving\{[^}]*animation:motion-spin 1\.6s linear infinite/);
 assert.match(source,/@media\(prefers-reduced-motion:reduce\)\{[^}]*navigation-overall\.driving\{animation:none/);
 assert.match(source,/\.navigation-overall-cruise-status\{flex:none;[^}]*text-align:center/);
 assert.match(source,/\.navigation-panel>\.navigation-overall\.driving\{[^}]*border-radius:0/);
 assert.match(source,/:aria-valuenow="overall.progress"/);assert.equal(elements(details)[0].tag,'summary');
});


test('単独・IDE・別窓タイトルは共通のCode操作ラベルと読み上げ名を使う',()=>{
 const toggles=walk(baseParse(descriptor.template.content)).filter(node=>hasClass(node,'navigation-code-toggle'));
 assert.equal(toggles.length,3);
 for(const button of toggles){
  assert.equal(button.props.find(p=>p.type===7&&p.arg?.content==='aria-label').exp.content,'codeToggleLabel');
  assert.equal(button.children.find(child=>child.type===5).content.content,'codeToggleLabel');
 }
 assert.match(source,/titleTools:.*'aria-label':codeToggleLabel\.value.*codeToggleLabel\.value/);
 assert.doesNotMatch(source,/Code \{\{codeOpen|\(codeOpen\.value\?'オン':'オフ'\)/);
});


test('自動航行はラベル・共通トグル・オンオフ表記を並べ、ネイティブbuttonの操作契約を保つ',()=>{
 const toggle=walk(baseParse(descriptor.template.content)).find(node=>hasClass(node,'navigation-autopilot-toggle'));
 assert.equal(toggle.tag,'button');assert.equal(attr(toggle,'type'),'button');assert.equal(attr(toggle,'role'),'switch');assert.equal(attr(toggle,'aria-label'),'自動航行（Navi Cruise）');
 assert.equal(toggle.props.find(p=>p.type===7&&p.arg?.content==='aria-checked').exp.content,'autopilot');
 assert.equal(toggle.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content,'!autopilot&&(!canAutopilot||!!autopilotController)');
 assert.equal(toggle.props.find(p=>p.type===7&&p.name==='on'&&p.arg?.content==='click').exp.content,'toggleAutopilot');
 const [label,track,state]=elements(toggle);assert.equal(label.children[0].content,'自動航行');assert.ok(hasClass(track,'motion-switch'));assert.equal(attr(track,'aria-hidden'),'true');
 assert.ok(hasClass(state,'navigation-autopilot-state'));assert.equal(attr(state,'aria-hidden'),'true');assert.equal(state.children[0].content.content,"autopilot?'オン':'オフ'");
 assert.ok(toggle.props.every(p=>!(p.type===7&&p.name==='on'&&['keydown','keyup'].includes(p.arg?.content))),'EnterとSpaceはbuttonの標準操作を使う');
});

test('自動航行のトグルはスクエアの共通レールでつまみ位置と色を切り替え、動きを減らす設定を尊重する',()=>{
 const css=descriptor.styles.map(style=>style.content).join('\n'),shared=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 assert.match(css,/\.navigation-autopilot-toggle\{[^}]*display:inline-flex;[^}]*align-items:center;[^}]*border-radius:0/);
 assert.match(shared,/\.motion-switch\{width:28px;height:14px/);assert.match(shared,/\.motion-switch:after\{[^}]*left:2px;[^}]*width:8px;height:8px/);
 assert.match(css,/\.navigation-autopilot-toggle\[aria-checked="true"\] \.motion-switch:after\{[^}]*transform:translateX\(14px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.navigation-autopilot-toggle \.motion-switch:after\{transition:none\}\}/);
});


test('自動航行の停止操作はトグル1つだけで、準備・Code実行・再評価中にも隠れず無効にならない',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),toggles=nodes.filter(node=>hasClass(node,'navigation-autopilot-toggle'));
 assert.equal(toggles.length,1);assert.equal(nodes.some(node=>node.tag==='button'&&node.props.some(p=>p.type===7&&p.name==='on'&&p.exp?.content==='stopAutopilot()')),false);
 const next=nodes.find(node=>hasClass(node,'navigation-next')),toggle=toggles[0];
 const condition=name=>next.props.find(p=>p.type===7&&p.name===name).exp.content;
 const visible=new Function('autopilot','result','history','routing',`return (${condition('if')})&&(${condition('show')});`);
 const disabled=new Function('autopilot','canAutopilot','autopilotController',`return ${toggle.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content};`);
 for(const routing of [false,true])for(const history of [false,true])for(const result of [null,{}]){
  assert.equal(visible(true,result,history,routing),true);assert.equal(disabled(true,false,{}),false);
 }
 assert.equal(visible(false,{},false,true),false,'手動調査中は従来どおり非表示');assert.equal(disabled(false,false,null),true);
});


test('ナビ・再評価の一方だけを薄紫にし、通常色・無効条件・実行中表示を保持する',()=>{
 const nodes=walk(baseParse(descriptor.template.content)),navi=nodes.find(node=>hasClass(node,'navigation-start')),evaluate=nodes.find(node=>hasClass(node,'navigation-evaluate'));
 assert.equal(navi.props.find(p=>p.type===7&&p.arg?.content==='class').exp.content,"{'is-routing':routing,'is-next-action':nextNavigationAction==='navigate'}");
 assert.equal(evaluate.props.find(p=>p.type===7&&p.arg?.content==='class').exp.content,"{'is-next-action':nextNavigationAction==='evaluate'}");
 assert.equal(navi.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content,'busy||autopilot||!availability.available');assert.equal(evaluate.props.find(p=>p.type===7&&p.arg?.content==='disabled').exp.content,'!canEvaluate||autopilot');
 const css=descriptor.styles.map(style=>style.content).join('\n');
 assert.match(css,/\.navigation-goal-form \.navigation-run\.is-next-action:not\(:disabled\)[^{]*\{background:#c4b5fd;color:#161026;border-color:#c4b5fd\}/);
 assert.match(css,/\.navigation-run\.is-next-action:not\(:disabled\) img\{filter:brightness\(0\)\}/);
 assert.match(css,/\.navigation-goal-form \.navigation-run:not\(:disabled\)\{background:#667eea;color:#fff\}/);
 assert.match(css,/\.navigation-goal-form \.navigation-run\.is-routing\{background:#667eea;color:#fff\}/);
});
