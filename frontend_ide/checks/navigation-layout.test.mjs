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
 for(const node of [overall,next])assert.equal(node.props.find(prop=>prop.type===7&&prop.name==='if').exp.content,'result&&!history');
 assert.match(source,/\.navigation-panel>\.navigation-overall\{flex:none;/);
 assert.match(source,/\.navigation-overall>\.navigation-disclosure\{min-height:0;overflow:auto\}/);
 assert.match(source,/>目標<small/);assert.doesNotMatch(descriptor.template.content,/未評価|>開発目標<\/label>/);
 assert.match(source,/:aria-valuenow="overall.progress"/);assert.match(source,/:aria-valuenow="item.progress"/);
});

const walk=node=>[node,...(node.children||[]).flatMap(walk)];
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
