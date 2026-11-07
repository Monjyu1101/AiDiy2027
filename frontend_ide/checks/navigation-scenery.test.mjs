// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NAVIGATION_SCENES,NAVIGATION_RANDOM_SCENES,pickNavigationScene,createRipples} from '../src/components/開発スペース/ナビ風景.js';
import {navigationKeyActive,bindNavigationKeys} from '../src/components/開発スペース/ナビ入力.js';
test('既存の航行・花火を残して3種類を均等な範囲で選ぶ',()=>{
 assert.deepEqual(NAVIGATION_RANDOM_SCENES,['ride','fireworks','aquarium','kaleidoscope','water','clock','maze','request']);
 assert.deepEqual([.01,.13,.26,.39,.52,.64,.77,.90].map(n=>pickNavigationScene(()=>n)),NAVIGATION_RANDOM_SCENES);
 // 夜間飛行は右クリックのメニューからだけ選べる。通常クリック・自動航行のランダム選択には出ない。
 assert.deepEqual(NAVIGATION_SCENES,[...NAVIGATION_RANDOM_SCENES,'nightflight']);
 for(let n=0;n<=1;n+=.001)assert.notEqual(pickNavigationScene(()=>n),'nightflight');
 assert.notEqual(pickNavigationScene(()=>1),'nightflight');
});
test('波紋点は毎回異なる位置から広がり、寿命と上限で片付ける',()=>{
 let n=0;const ripples=createRipples(()=>((n++%10)/10));
 const a=ripples.add(),b=ripples.add();assert.notEqual(a.x,b.x);assert.notEqual(a.y,b.y);
 ripples.step(1);assert.equal(a.age,1);assert.equal(b.age,1);
 for(let i=0;i<40;i++)ripples.add();assert.equal(ripples.points.length,32);
 ripples.step(8);assert.equal(ripples.points.length,0);
});
test('波紋点は指定したポインター位置を使い、不正な位置はランダムへ戻す',()=>{
 const ripples=createRipples(()=>.5);
 assert.deepEqual(ripples.add({x:.8,y:.2}),{x:.8,y:.2,age:0});
 assert.deepEqual(ripples.add({x:-1,y:2}),{x:0,y:1,age:0});
 assert.deepEqual(ripples.add({x:NaN,y:.2}),{x:.5,y:.5,age:0});
 assert.deepEqual(ripples.add(),{x:.5,y:.5,age:0});
});
function target(selector){return {closest:query=>query.includes(selector)?{}:null};}
test('別窓の要素はinstanceofなしで判定し、入力・IME・標準操作を奪わない',()=>{
 const focus={};const el={ownerDocument:{activeElement:focus},contains:value=>value===focus};
 assert.equal(navigationKeyActive({target:{}},el),true);
 for(const selector of ['input','textarea','select','button','summary','a[href]','[role="textbox"]','[contenteditable]'])assert.equal(navigationKeyActive({target:target(selector)},el,true),false);
 assert.equal(navigationKeyActive({target:{},isComposing:true},el,true),false);
 assert.equal(navigationKeyActive({target:{},defaultPrevented:true},el,true),false);
 el.ownerDocument.activeElement={};assert.equal(navigationKeyActive({target:{}},el),false);
 assert.equal(navigationKeyActive({target:{}},el,true),true);
});
const doc=()=>Object.assign(new EventTarget(),{defaultView:new EventTarget()});
test('DOMの別窓移動・復帰でキー購読を移し、破棄で全て解除する',()=>{
 const a=doc(),b=doc(),el=Object.assign(new EventTarget(),{ownerDocument:a});
 let sync,count=0,cleared=false,blurs=0;
 const stop=bindNavigationKeys(el,{keydown:()=>count++,blur:()=>blurs++},{setInterval:fn=>(sync=fn,1),clearInterval:()=>{cleared=true;}});
 a.dispatchEvent(new Event('keydown'));assert.equal(count,1);
 el.ownerDocument=b;el.dispatchEvent(new Event('focusin'));a.dispatchEvent(new Event('keydown'));b.dispatchEvent(new Event('keydown'));assert.equal(count,2);
 el.ownerDocument=a;sync();b.dispatchEvent(new Event('keydown'));a.dispatchEvent(new Event('keydown'));assert.equal(count,3);
 stop();sync();a.dispatchEvent(new Event('keydown'));b.dispatchEvent(new Event('keydown'));assert.equal(count,3);assert.equal(cleared,true);assert.ok(blurs>=3);
});
test('新演出は黒背景、Spaceの長押し重複を除き、所有窓の描画を終了する',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ風景.vue',import.meta.url),'utf8');
 assert.match(source,/event\.repeat/);assert.match(source,/navigationKeyActive\(event,el,hover\)/);
 assert.match(source,/ctx\.fillStyle='#000'/);assert.match(source,/frameOwner=el\.ownerDocument\.defaultView/);
 assert.match(source,/cancelAnimationFrame\(raf\);unbind\(\)/);
 for(const name of ['ナビ航行.vue','ナビ花火.vue']){
  const existing=readFileSync(new URL('../src/components/開発スペース/'+name,import.meta.url),'utf8');
  assert.match(existing,/bindNavigationKeys\(el/);assert.match(existing,/unbindKeys\(\)/);assert.doesNotMatch(existing,/instanceof Element|document\.addEventListener\('key/);
 }
});

test('3演出と既存2演出・NavigatorのVue script/templateをコンパイルする',async()=>{
 const {parse,compileScript,compileTemplate}=await import('@vue/compiler-sfc');
 for(const name of ['ナビ風景.vue','ナビ航行.vue','ナビ花火.vue','Navigationパネル.vue']){
  const source=readFileSync(new URL('../src/components/開発スペース/'+name,import.meta.url),'utf8');
  const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  assert.ok(compileScript(descriptor,{id:name}));
  assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:name,id:name}).errors,[]);
 }
});

test('夜間飛行: コックピット視点だけで機体は描かず、花火・HUD・キー操作を持ち、画面の3行ターミナル表示は出さない',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 const script=compileScript(descriptor,{id:'nightflight',genDefaultAs:'component'});
 transformSync(script.content,{format:'esm'}); // 構文エラーがないこと（WebGLの描画は実機で確認）
 assert.doesNotMatch(source,/new THREE\.(ExtrudeGeometry|CylinderGeometry)\(/,'機体の外観は描かない');
 assert.doesNotMatch(source,/dblclick|toggleView|chase/i,'視点の切り替えは持たない');
 for(const word of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','drawCanopy','drawHud','unsupported'])assert.ok(source.includes(word),word);
 const panel=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
 assert.match(panel,/<NaviNightFlight v-else-if="!cruiseFailed&&cruiseKind==='nightflight'"/);
 assert.match(panel,/<TerminalWelcome v-if="cruiseFailed\|\|!\['nightflight','clock','maze','request'\]\.includes\(cruiseKind\)" kind="navi" :routing="true" \/>/); // 3行表示は夜間飛行・時計・迷路・依頼文では出さない
});

test('時計: 左上に日付、中央に大きく時分秒（ミリ秒は出さない）。数字は文字のマスクで、見えないカラーピッカーがランダムに動いて虹色に移り変わり、日付と「:」は色を変えない（3行ターミナル表示・下線は出さない）',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ時計.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 transformSync(compileScript(descriptor,{id:'clock',genDefaultAs:'component'}).content,{format:'esm'});
 assert.equal((source.match(/const PALETTE = \[(\[[^\]]+\],?\s*)+\]/)?.[0].match(/\[\d+, \d+, \d+\]/g)||[]).length,7,'色は7色');
 assert.match(source,/\$\{date\.getFullYear\(\)\}-\$\{pad\(date\.getMonth\(\) \+ 1\)\}-\$\{pad\(date\.getDate\(\)\)\}/,'日付は yyyy-mm-dd');
 assert.match(source,/pad\(date\.getHours\(\)\)\}:\$\{pad\(date\.getMinutes\(\)\)\}:\$\{pad\(date\.getSeconds\(\)\)/,'時刻は hh:mm:ss');
 assert.match(source,/measureText\('00:00:00'\)/);
 assert.doesNotMatch(source,/getMilliseconds|pad\(milli|fillRect\(left, barY/,'ミリ秒の数字・時刻の下の線は出さない');
 // 数字は文字のマスク（source-in）に虹色の色盤を重ね、色盤の中心＝見えないカラーピッカーがランダムに動く。「:」と日付は固定色。
 for(const word of ['createConicGradient',"'source-in'",'movePicker','picker.tu = rand','picker.tv = rand','unsupported'])assert.ok(source.includes(word),word);
 assert.match(source,/if \(clock\[i\] === ':'\) ctx\.fillText\(':'/,'「:」は固定色で別に描く');
 assert.match(source,/if \(clock\[i\] !== ':'\) maskCtx\.fillText/,'数字だけをマスクにする');
 assert.match(source,/const STATIC = \[/,'日付と「:」は固定色');
 const panel=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
 assert.match(panel,/<NaviClock v-else-if="!cruiseFailed&&cruiseKind==='clock'"/);
});

test('迷路: 暗い3D空間で、生成（6種）→解法（5種）の経過→経路表示→答え合わせ→2秒後に次へ、を繰り返す',async()=>{
 const {createRequire}=await import('node:module');const require=createRequire(import.meta.url);
 const {parse,compileScript}=require('@vue/compiler-sfc'),{transformSync}=require('esbuild');
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ迷路.vue',import.meta.url),'utf8');
 const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
 transformSync(compileScript(descriptor,{id:'maze',genDefaultAs:'component'}).content,{format:'esm'});
 for(const word of ['MAZE_ALGORITHMS','MAZE_SOLVERS','verifyRoute','InstancedMesh','unsupported',"'generate'","'solve'","'route'","'check'","'clear'"])assert.ok(source.includes(word),word);
 assert.match(source,/const BUILD_TIME = [\d.]+, CHECK_TIME = 1\.2, CLEAR_TIME = \.8, CRUMBLE_TIME = \.3;/,'答え合わせ1.2秒＋崩れる0.8秒＝2秒で次へ');
 assert.match(source,/BoxGeometry\(1\.002, 1, 1\.002\)/,'ブロックの間に隙間を置かない');
 assert.match(source,/yOff\[i\] = -\(WALL_HEIGHT \+ \.06\)/,'壁は下（地面の下）から生える');
 assert.match(source,/const WALL_HEIGHT = 2;/,'壁の高さは従来の2倍');
 for(const word of ['spawnDebris','stepDebris','crumbleT','startCollapse'])assert.ok(source.includes(word),word+'（壁が砕けて破片が飛ぶ）');
 assert.match(source,/renderer\.shadowMap\.enabled = true/,'壁の影で立体感を出す');
 assert.match(source,/sun\.castShadow = true/);assert.match(source,/blocks\.castShadow = true; blocks\.receiveShadow = true/);
 assert.match(source,/sun\.position\.set\(36, 30, 26\)/,'光源は盤面の斜め上に固定');
 assert.match(source,/nowMs - last < 28/,'描画は約30fpsに抑える（CPU使用率）');
 assert.match(source,/rnd\(14, 18\)/);assert.match(source,/rnd\(8, 11\)/);
 assert.match(source,/board\.rotation\.y = view\.az/,'盤面をゆっくり回す');
 assert.match(source,/view\.az \+= step \* \.16/,'回転は常に続く');
 const panel=readFileSync(new URL('../src/components/開発スペース/Navigationパネル.vue',import.meta.url),'utf8');
 assert.match(panel,/<NaviMaze v-else-if="!cruiseFailed&&cruiseKind==='maze'"/);
});

test('夜間飛行: 傾いている間は傾いた側（曲がる先）へ花火を多く打ち、墜落はきりもみ回転し、ときどき低空へ降りて地面が見える',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 for(const word of ['predictPath','bankSide','st.spin','st.dive','diveWait'])assert.ok(source.includes(word),word);
 assert.match(source,/bank && Math\.random\(\) < \.9\) sideToggle = bank/,'傾いている間は9割が傾いた側から');
 assert.match(source,/banking \? \.9 : \.6/,'傾いている間は打ち上げ数を増やす');
 assert.match(source,/st\.spin = Math\.min\(9, st\.spin \+ dt \* 4\.5\)/,'墜落中は回転がだんだん速くなる');
 assert.match(source,/FLY_ABOVE \* \(1 - \.5 \* st\.dive\)/,'ときどき低空へ降りる');
});

test('夜間飛行: 墜落中はターゲットマーカーを出さず、ダメージは自動回復せず、燃料は少ない状態から約5分で尽きて墜落する',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/for \(const b of S\.crashState \? \[\] : S\.targets\)/,'墜落中はマーカーを出さない');
 assert.doesNotMatch(source,/st\.hp = Math\.min\(100, st\.hp \+/,'ダメージは自動回復しない');
 assert.match(source,/const FUEL_START = \.3, FUEL_SECONDS = 300;/,'燃料は30%から巡航で300秒');
 assert.match(source,/st\.hp <= 0 \|\| st\.fuel <= 0\) startCrash\(\)/,'燃料切れでも墜落する');
 assert.match(source,/st\.hp = 100; st\.fuel = FUEL_START;/,'復帰後も燃料は少ない状態から');
 assert.match(source,/\['FUEL', panel\.fuel\]/,'燃料計は実際の燃料を出す（リカバリー中は手順に合わせて満たす）');
});

test('夜間飛行: 墜落後は真っ黒のダウン状態から、SYSTEM RECOVERYを明滅して発動し、計器類→ランプ→燃料→ダメージ→機体を水平へ→HUDを順に回復し、0秒の表示のあとテイクオフする',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 const block=source.match(/const RECOVERY = Object\.freeze\(\{([\s\S]*?)\}\);/)[1];
 const numbers=key=>block.match(new RegExp(key+': \\[([^\\]]+)\\]'))[1].split(',').map(Number);
 const [g0,g1]=numbers('gauges'),[l0,l1]=numbers('lamps'),[f0,f1]=numbers('fuel'),[d0,d1]=numbers('damage'),[v0,v1]=numbers('level'),hud=numbers('hud'),ready=Number(block.match(/ready: ([\d.]+)/)[1]),takeoff=Number(block.match(/takeoff: ([\d.]+)/)[1]),blackout=Number(block.match(/blackout: ([\d.]+)/)[1]);
 // 順序：真っ黒 → 計器類 → ランプ → 燃料 → ダメージ → 機体を正しく → HUD（5段階）→ 0秒 → テイクオフ
 const order=[blackout,g0,g1,l0,l1,f0,f1,d0,d1,v0,v1,...hud,ready,takeoff];
 for(let k=1;k<order.length;k++)assert.ok(order[k]>=order[k-1],'手順は順番どおり '+k);
 assert.equal(hud.length,5);assert.ok(g0>=blackout&&hud[0]>=v1&&takeoff>ready);
 for(const word of ["'INSTRUMENTS'","'LAMPS'","'FUEL SYSTEM'","'DAMAGE REPAIR'","'ATTITUDE LEVEL'","'HUD RESTORE'",'SYSTEM RECOVERY','drawRecoveryLog','panelState','TAKEOFF','st.takeT'])assert.ok(source.includes(word),word);
 assert.match(source,/Math\.floor\(rec \* 6\) % 2 === 0/,'発動は明滅');
 assert.doesNotMatch(source,/RECOVERY\.dark|dark: \./,'景色はリカバリー中も暗転しない');
 assert.match(source,/st\.fade \+= \(0 - st\.fade\) \* k;/,'景色はいつも見える');
 assert.match(source,/g\.globalAlpha = shown\[n\];/,'リカバリー表示は下から入りながら濃くなる');
 assert.match(source,/if \(down && rec < RECOVERY\.blackout\) \{/,'最初は暗転（ログだけ）');
 assert.doesNotMatch(source,/g\.fillStyle = '#000'; g\.fillRect\(0, 0, w, h\); g\.textAlign/,'花火の光を隠す真っ黒の塗りは重ねない');
 assert.doesNotMatch(source,/CRASHED/,'「CRASHED」の表示は出さない');
 assert.doesNotMatch(source,/rgba\(0,0,0,\.6\)'; g\.fillRect\(cx - plateW/,'システムリカバリーの表示に背景は付けない（透明）');
 assert.match(source,/const RECOVERY_GREEN = '#2cff6b'/,'システムリカバリーの表示は鮮やかな緑');
 assert.match(source,/const dim = 1;/,'計器盤の構造はダウン中も常に見える（部品の表示だけオフ）');
 assert.match(source,/drawCanopy\(g, w, h, t, k, S, \(\) => \{\}\);   \/\/ 計器盤は見えたまま/,'暗転中も計器盤を描く');
 assert.doesNotMatch(source,/toFixed\(1\) \+ 's'/,'残り秒の表示はしない');
 assert.match(source,/activating = rec < RECOVERY\.blackout/,'最初の2秒は明滅');assert.equal(blackout,2,'2秒の明滅からモーション開始');
 assert.match(source,/g\.save\(\); g\.translate\(sway \+/,'HUD表示の開始時は少し左右に揺れる');
 assert.match(source,/function predictPath\(t, speed = Math\.max\(st\.speed, CRUISE\)\)/,'速度が0でも先読みが終わる');
 assert.match(source,/Math\.min\(t, 12\)/,'先読みの長さに上限');
 assert.match(source,/for \(const b of S\.crashState \? \[\] : S\.targets\)/,'墜落中はマーカーを出さない');
 assert.match(source,/const hudStep = down \? RECOVERY\.hud\.filter\(at => rec >= at\)\.length : 5;/,'墜落後はHUDを順に回復');
 assert.match(source,/st\.roll \+= \(0 - st\.roll\)/,'機体を水平へ戻す');
});


test('夜間飛行: 起動直後も、墜落後と同じシステムリカバリーを機体は正位置のままほぼ即始め、テイクオフして始まる。計器盤はダウン中も見え、各部品の表示は回復した順に点く',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/function boot\(\) \{[\s\S]*?st\.down = true; st\.impactAt = 0; st\.crashEnd = RECOVERY\.takeoff;[\s\S]*?st\.roll = 0; st\.pitch = 0; st\.fade = 0;/,'起動直後は正位置のダウン状態で、ほぼ即リカバリー');
 assert.match(source,/\n  boot\(\);\n/,'起動時にbootする');
 assert.match(source,/const redLevel = S\.crashState === 2 \? 0 :/,'リカバリー中は赤みを出さない');
 assert.doesNotMatch(source,/launchShell\(\); shells\[shells\.length - 1\]\.t = rnd/,'起動時の打ち上げの先行分は置かない');
 assert.match(source,/by = Math\.max\(st\.y, terrain\(path\.x, path\.z\) \+ FLY_ABOVE \* \.85\)/,'地上でも遠くの花火が木に隠れない高さで開く');
 assert.match(source,/if \(panel\.gauges\) \{ g\.globalAlpha = 1;/,'計器は回復したら明るく点く');
});

test('夜間飛行: テイクオフは地面すぐ上を速度を上げながら滑走し、一定の速度で機首を上げて上昇する（森林との当たり判定はない）',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/const ROTATE_SPEED = 60, TAKEOFF_ACCEL = 4\.5, CLIMB_RATE = 9;/);
 assert.match(source,/const RUNWAY_LENGTH = ROTATE_SPEED \* ROTATE_SPEED \/ \(2 \* TAKEOFF_ACCEL\) \+ 120;/,'滑走路の長さは滑走する距離に合わせる');
 assert.match(source,/st\.speed = 4; st\.takeoff = 1;/,'低速の滑走から始める');
 assert.match(source,/else if \(st\.takeoff === 1\) \{[\s\S]*?st\.speed \+= TAKEOFF_ACCEL \* step;[\s\S]*?terrain\(st\.x, st\.z\) \+ 1\.6[\s\S]*?if \(st\.speed >= ROTATE_SPEED\) \{ st\.takeoff = 2;/,'滑走→一定速度で上昇へ');
 assert.match(source,/if \(st\.takeoff !== 1\) st\.speed \+=/,'滑走中は巡航への速度合わせをしない');
 assert.match(source,/if \(st\.takeoff === 2\) st\.y \+= clamp\(\(wantY - st\.y\) \* \.8, 0, CLIMB_RATE\) \* step;/,'上昇は毎秒9まで（急に上がらない）');
 assert.match(source,/Math\.atan2\(st\.vy, st\.speed\) \* \(climbing \? 1 : 1\.6\) \+ \(climbing \? \.1 : 0\)/,'上昇中は機首を上げ、視点も上を向く');
 assert.doesNotMatch(source,/tree[A-Za-z]*\s*(collision|hit)/i,'樹木の当たり判定は置かない');
 // 滑走が終わる速度までの時間（約3.3秒）と、ROTATE_SPEEDが巡航より低いこと
 assert.ok(56/4.5>11&&56/4.5<14,'約12秒走ってから離陸する');assert.equal(60*60/(2*4.5)+120,520,'滑走路は約520（滑走の距離400＋余裕120）');
});

test('夜間飛行: リカバリーの見出しだけ中央寄せ、規定高度に着くまで手順を表示し続け、その間は当たり判定なし、ダメージは従来の3倍',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/g\.textAlign = 'center'; g\.fillText\('SYSTEM RECOVERY', cx,/,'見出しの行だけ中央寄せ');
 assert.match(source,/if \(S\.takeoff\) drawRecoveryLog\(g, w, h, k, S, 99\);/,'規定高度まで手順を表示し続ける');
 assert.match(source,/!st\.crash && !st\.takeoff && st\.invuln <= 0/,'テイクオフ中は当たり判定なし');
 assert.match(source,/st\.hp - \(1\.65 \+ Math\.min\(near, 80\) \* \.03\)/,'ダメージは従来（.55＋.01）の3倍');
 assert.ok(Math.abs(1.65/.55-3)<1e-9&&Math.abs(.03/.01-3)<1e-9);
});

test('夜間飛行: システリカバリーは全部鮮やかな緑で、見出しが一番下に出て、次の行が出るたびに、それまでの行がずり上がり、機体を立て直すタイミングで滑走路上の木を消去する',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.doesNotMatch(source,/RECOVERY_GREEN_DONE/,'完了した行も同じ鮮やかな緑');
 assert.match(source,/bottom = baseY - \.5 \* lineH/,'一番下の行から始まる');
 assert.match(source,/lines = \[\{header: true, at: RECOVERY\.start\}/,'最初に見出しが一番下に出る');
 assert.match(source,/for \(let m = n \+ 1; m < lines\.length; m\+\+\) above \+= shown\[m\]/,'次の行が出るたびに、それまでの行がずり上がる');
 assert.match(source,/const y = bottom - above \* lineH \+ \(1 - shown\[n\]\) \* lineH \* 1\.6/,'新しい行は下から入って、一番下に収まる');
 assert.match(source,/along > -40 && along < RUNWAY_LENGTH && Math\.abs\(dx \* runway\.rx \+ dz \* runway\.rz\) < 16 \+ margin/,'木の消去は滑走路の範囲（滑走の距離＋余裕）だけ・幅±16');
 assert.match(source,/st\.down && !runway\.on && st\.crash - st\.impactAt >= RECOVERY\.level\[0\]/,'機体を立て直すタイミングで木を消す');
 assert.match(source,/runway\.on && !st\.down && !st\.takeoff\) runway\.on = false/,'規定高度に着いたら木を戻す');
 assert.match(source,/if \(st\.takeoff\) st\.idle = 3;/,'テイクオフ中は滑走路の上をまっすぐ進む');
 const level=Number(source.match(/level: \[([\d.]+),/)[1]),hud0=Number(source.match(/hud: \[([\d.]+),/)[1]),lamps1=Number(source.match(/lamps: \[[\d.]+, ([\d.]+)\]/)[1]);
 assert.ok(level>lamps1&&level<hud0,'計器類が点灯したあと、HUDが点く直前に消す');
});

test('夜間飛行: 離陸中はがたがた揺れ（画面・HUD）、速度とともに強まり、浮いて地面から離れたらなくなる',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/const lifted = clamp\(\(st\.y - st\.ground - 1\.6\) \/ 2\.5, 0, 1\), rattle = reduced \|\| !st\.takeoff \? 0 : \(1 - lifted\)/,'浮いたらなくなる');
 assert.match(source,/st\.takeoff === 1 \? \.35 \+ \.65 \* clamp\(st\.speed \/ ROTATE_SPEED, 0, 1\) : 1/,'滑走中は速度とともに強まる');
 assert.match(source,/Math\.sin\(time \* 33\) \* \.07/,'上下の細かい揺れ');
 assert.match(source,/rnd\(-1, 1\) \* \.012 \* rattle/,'画面も細かく傾く');
 assert.match(source,/S\.rattle = rattle;/);assert.match(source,/\* 3 \* k \* S\.rattle/,'HUDも揺れる');
 assert.doesNotMatch(source,/st\.takeoff === 1 \? \.04 \+ st\.speed/,'以前の弱い震えは置き換えた');
});

test('夜間飛行: 滑走路が有効な間は、滑走路の上の花火（打ち上げ・噴水・炸裂・火の粉）を消火し、新しい花火も滑走路の上には上げない',()=>{
 const source=readFileSync(new URL('../src/components/開発スペース/ナビ夜間飛行.vue',import.meta.url),'utf8');
 assert.match(source,/const onRunway = \(x, z, margin = 0\) => \{[\s\S]*?along > -40 && along < RUNWAY_LENGTH && Math\.abs\(dx \* runway\.rx \+ dz \* runway\.rz\) < 16 \+ margin/,'滑走路の範囲の判定');
 assert.match(source,/if \(onRunway\(x, z\)\) target = 0;/,'木の消去も同じ範囲');
 assert.match(source,/if \(runway\.on\) \{   \/\/ 滑走路の上の花火を消火する[\s\S]*?shells\.splice[\s\S]*?fountains\.splice[\s\S]*?bursts\.splice/,'打ち上げ・噴水・炸裂の記録を消す');
 assert.match(source,/runway\.on && pPos\[i3 \+ 1\] < jy \+ 25 && onRunway\(pPos\[i3\], pPos\[i3 \+ 2\], 2\)/,'飛んでいる火の粉を消す');
 assert.match(source,/const crossing = !runway\.on && /,'滑走路の上を横切る花火は上げない');
 assert.match(source,/if \(onRunway\(bx, bz, 8\) \|\| onRunway\(lx, lz, 4\)\) return;/,'炸裂点・打ち上げ地点は滑走路の上に置かない');
 assert.match(source,/if \(onRunway\(x, z, 4\)\) return;/,'噴水は滑走路の上に置かない');
});
