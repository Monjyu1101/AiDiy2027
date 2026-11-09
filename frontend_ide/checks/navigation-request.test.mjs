// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {requestSegments,pickFlight,COMMENT_ALPHA,COMMENT_COLORS,FLIGHT,COMMENT_PLACEHOLDER,COMMENT_MAX_LENGTH} from '../src/components/開発スペース/ナビ依頼文.js';

test('依頼文の断片化: 改行・句点で分け、長いものは読点や文字数で刻み、空なら「調査中…」',()=>{
 assert.deepEqual(requestSegments('短い依頼'),['短い依頼']);
 assert.deepEqual(requestSegments('一行目\n二行目。三行目！'),['一行目','二行目','三行目']);   // 断片の末尾の区切り（。！など）は表示しない
 // 先に改行・句点で細かく分け、長すぎる断片だけ読点でも分ける（短い断片は読点で分けない）
 assert.deepEqual(requestSegments('A、B。C、D\nE；F'),['A、B','C、D','E','F']);   // 末尾の「。」「；」は出さず、途中の「、」は残す
 assert.deepEqual(requestSegments('あいうえおかきくけこ、さしすせそたちつてと、なにぬねのはひふへほ。'),['あいうえおかきくけこ、さしすせそたちつてと','なにぬねのはひふへほ']);
 assert.deepEqual(requestSegments(''),[COMMENT_PLACEHOLDER]);assert.deepEqual(requestSegments('  \n \n'),[COMMENT_PLACEHOLDER]);assert.deepEqual(requestSegments(undefined),[COMMENT_PLACEHOLDER]);
 const long='今回の目標は、現行のaidiy_naviのセルフテスト再実行において、実AIによるナビ作成・再評価が正しく完了し、調査対象のファイルを変更しないことを確認することです。';
 const pieces=requestSegments(long);assert.ok(pieces.length>=3);
 for(const piece of pieces)assert.ok(piece.length<=COMMENT_MAX_LENGTH&&piece.length>0,piece);
 const punctuation=/[、。，,．.！？!?；;：:]/g;   // 末尾の区切りだけを除き、文字は落とさない
 assert.equal(pieces.join('').replace(punctuation,''),long.replace(/\s+/g,' ').replace(punctuation,''));
 for(const piece of pieces)assert.doesNotMatch(piece,/[、。，,．.！？!?；;：:]$/u,'末尾の区切りは出さない');
 assert.equal(requestSegments('x'.repeat(50)).join(''),'x'.repeat(50));
});

test('コメントの決め方: 遠くから視点へ迫る3Dの飛び方を、大きさ・速さ・色・位置・横流れともランダムに決め、範囲に収める',()=>{
 const xs=new Set(),heights=new Set(),speeds=new Set(),colors=new Set(),drifts=new Set();
 for(let k=0;k<400;k++){
  const f=pickFlight(['ab','これは少し長めのコメントです']);
  assert.ok(f.z<=-FLIGHT.start.min&&f.z>=-FLIGHT.start.max,'遠く（前方）から始まる');
  assert.ok(f.height>=FLIGHT.height.min&&f.height<=FLIGHT.height.max);assert.ok(f.speed>=FLIGHT.speed.min&&f.speed<=FLIGHT.speed.max);
  assert.ok(Math.abs(f.x)>=FLIGHT.clear&&Math.abs(f.x)<=FLIGHT.x,'視点の真正面は避け、左右をかすめる');assert.ok(Math.abs(f.y)<=FLIGHT.y&&Math.abs(f.vx)<=FLIGHT.drift);
  assert.ok(COMMENT_COLORS.includes(f.color));
  // 遠くから背後へ通り過ぎるまでに約2〜8秒かかる（視点の背後 FLIGHT.passed まで）
  const seconds=(FLIGHT.passed-f.z)/f.speed;assert.ok(seconds>=(FLIGHT.start.min+FLIGHT.passed)/FLIGHT.speed.max-1e-9&&seconds<=(FLIGHT.start.max+FLIGHT.passed)/FLIGHT.speed.min+1e-9);
  xs.add(Math.round(f.x));heights.add(f.height.toFixed(2));speeds.add(f.speed.toFixed(1));colors.add(f.color);drifts.add(Math.sign(f.vx));
 }
 assert.ok(xs.size>15&&heights.size>100&&speeds.size>100&&colors.size>=7&&drifts.size===2,'ばらつく（横流れは左右どちらにも）');
 const fixed=pickFlight(['x'],()=>0);assert.equal(fixed.height,FLIGHT.height.min);assert.equal(fixed.z,-FLIGHT.start.min);assert.ok(fixed.x<0);
});

test('文字色は暗めで薄い（彩度を抑えた色で、全体も透かす）',()=>{
 const luminance=hex=>{const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));return .2126*r+.7152*g+.0722*b;};
 const saturation=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)),max=Math.max(...v),min=Math.min(...v);return max?(max-min)/max:0;};
 assert.equal(COMMENT_COLORS.length,10);
 for(const color of COMMENT_COLORS){assert.ok(luminance(color)<=175,color+' 明るすぎない');assert.ok(saturation(color)<=.4,color+' 彩度を抑える');}
 assert.ok(COMMENT_ALPHA<.75&&COMMENT_ALPHA>=.55);
});

test('依頼文の画面: ニコニコ動画のように左右から流し、依頼文をpropで受け取り、画面上の3行ターミナル表示は出さない',async()=>{
 const require=createRequire(import.meta.url),{parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ依頼文.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 transformSync(compileScript(descriptor,{id:'request',genDefaultAs:'component'}).content,{format:'esm'});
 for(const word of ['requestSegments','pickFlight','props.text','strokeText','WebGLRenderer','CanvasTexture','unsupported','spawn(far)'])assert.ok(source.includes(word),word);
 assert.doesNotMatch(source,/strokeText\(c\.text/,'毎フレーム文字を描き直さない（断片ごとに1度だけテクスチャにする）');
 const panel=readFileSync(new URL('../src/components/開発スペース/Naviパネル.vue',import.meta.url),'utf8');
 assert.match(panel,/<NaviRequest v-else-if="!cruiseFailed&&cruiseKind==='request'" :text="recommendedPrompt\|\|goal"/,'依頼文はプロンプト案（無いときだけ目標）');
});
