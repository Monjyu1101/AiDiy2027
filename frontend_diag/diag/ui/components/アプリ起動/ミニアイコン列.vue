<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,onMounted,onBeforeUnmount} from 'vue';

const 枠=ref(null),列=ref(null);
const 一周=(位置,長さ)=>((位置%長さ)+長さ)%長さ;
let ボタン=[],間隔=0,周期=0,位置=0,はみ出す=false,段数=1;
let frame=0,前回=0,hover=false,focus=false,操作,クリックを止める=false;
let resizeObserver,mutationObserver,launchObserver,起動演出中=false;

function 配置(){
 for(const [index,button] of ボタン.entries()){
  // 両端の外で同じボタンを回し、起動ボタンやTab順を複製しない。
  const 基準=Math.floor(index/段数)*間隔;
  const x=一周(基準+位置+間隔,周期)-間隔;
  button.style.transform=`translateX(${x-基準}px)`;
 }
}
function 進める(now){
 frame=0;
 if(前回){
  位置=一周(位置-Math.min(now-前回,50)*.028,周期);
  配置();
 }
 前回=now;
 再生を更新();
}
function 再生を更新(){
 if(はみ出す&&!hover&&!focus&&!操作&&!起動演出中){
  if(!frame)frame=requestAnimationFrame(進める);
 }else{
  if(frame)cancelAnimationFrame(frame);
  frame=前回=0;
 }
}
function 寸法を更新(){
 const row=列.value;
 ボタン=[...row.children];
 const gap=parseFloat(getComputedStyle(row).columnGap)||0;
 const 幅=枠.value.clientWidth;
 間隔=(ボタン[0]?.offsetWidth||0)+gap;
 // 全一覧の1段時の必要高から余剰を求め、段数変更で測定が振動しないようにする。
 const scroll=枠.value.closest('.mini-launch-scroll');
 if(scroll){
  const tracks=[...scroll.querySelectorAll('.mini-icon-track')];
  const baseHeight=[...scroll.children].reduce((sum,child)=>{const css=getComputedStyle(child);return sum+child.getBoundingClientRect().height+(parseFloat(css.marginTop)||0)+(parseFloat(css.marginBottom)||0);},0)-tracks.reduce((sum,track)=>sum+Math.max(0,track.clientHeight-42),0);
  const extra=Math.max(0,scroll.clientHeight-baseHeight);
  段数=Math.max(1,1+Math.floor(extra/Math.max(1,tracks.length)/44));
 }else 段数=1;
 const 収容列数=間隔?Math.floor((幅+gap)/間隔):0;
 const 必要段数=収容列数>0?Math.ceil(ボタン.length/収容列数):1;
 // 全件を静止表示できる場合だけ複数段へ。入らない間は従来の1段循環を維持。
 段数=必要段数<=段数?Math.max(1,必要段数):1;
 row.style.gridTemplateRows=`repeat(${段数},42px)`;
 // 表示幅は親の右端まで使う。ボタンが少ない場合も、折り返しは両端の外で行う。
 周期=Math.max(Math.ceil(ボタン.length/段数)*間隔,幅+間隔);
 const 列数=間隔&&Math.floor((幅+gap)/間隔);
 はみ出す=幅>0&&ボタン.length>列数*段数;
 row.toggleAttribute('data-overflow',はみ出す);
 if(はみ出す)配置();
 else{
  位置=0;
  for(const button of ボタン)button.style.transform='';
 }
 再生を更新();
}
function ホバー(value){hover=value;再生を更新();}
function 押す(event){
 クリックを止める=false;
 if(!はみ出す||event.button!==0||!event.isPrimary)return;
 操作={id:event.pointerId,x:event.clientX,位置,移動:false};
 event.target.setPointerCapture?.(event.pointerId);
 再生を更新();
}
function 動かす(event){
 if(!操作||操作.id!==event.pointerId||!はみ出す)return;
 const 差=event.clientX-操作.x;
 if(!操作.移動&&Math.abs(差)<4)return;
 操作.移動=true;
 クリックを止める=true;
 位置=一周(操作.位置+差,周期);
 配置();
}
function 離す(event){
 if(操作?.id!==event.pointerId)return;
 操作=undefined;
 再生を更新();
}
function クリック(event){
 if(クリックを止める&&event.detail>0){
  event.preventDefault();
  event.stopPropagation();
  クリックを止める=false;
 }
}
function フォーカス(event){
 focus=event.target.matches(':focus-visible');
 if(focus&&はみ出す){
  const {left,right}=列.value.getBoundingClientRect();
  const icon=event.target.getBoundingClientRect();
  位置+=Math.max(0,left-icon.left)-Math.max(0,icon.right-right);
  配置();
 }
 再生を更新();
}
function フォーカス解除(event){
 if(!列.value.contains(event.relatedTarget)){focus=false;再生を更新();}
}
onMounted(()=>{
 if(typeof 枠.value?.getBoundingClientRect!=='function')return;
 resizeObserver=new ResizeObserver(寸法を更新);
 resizeObserver.observe(枠.value);
 const scroll=枠.value.closest('.mini-launch-scroll');
 if(scroll)resizeObserver.observe(scroll);
 mutationObserver=new MutationObserver(寸法を更新);
 mutationObserver.observe(列.value,{childList:true});
 // 上下どちらの列で受付の光が回っていても、自動送りを止める。
 // 実際の演出状態を見るため、連打・同時起動・取消・ボタン削除にも追従する。
 const launchRoot=枠.value.closest('.mini-content')||列.value;
 const 演出を確認=()=>{起動演出中=!!launchRoot.querySelector('.launch-frame.launch-active');寸法を更新();};
 launchObserver=new MutationObserver(演出を確認);
 launchObserver.observe(launchRoot,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
 演出を確認();
 寸法を更新();
});
onBeforeUnmount(()=>{
 resizeObserver?.disconnect();mutationObserver?.disconnect();launchObserver?.disconnect();
 if(frame)cancelAnimationFrame(frame);
});
</script>

<template>
 <div ref="枠">
  <div ref="列" class="mini-icon-track" @pointerenter="ホバー(true)" @pointerleave="ホバー(false)"
    @pointerdown="押す" @pointermove="動かす" @pointerup="離す" @pointercancel="離す" @lostpointercapture="離す"
    @focusin="フォーカス" @focusout="フォーカス解除" @dragstart.prevent @click.capture="クリック">
   <slot />
  </div>
 </div>
</template>
