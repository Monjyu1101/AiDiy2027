// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './components/共通表示/会話表示.css';
// バーガーの線の太さ・間隔を表示倍率の整数画素へそろえ、三本を同じ濃さで描く（125% などでも中央だけ滲まない）。
function snapBurgerLines(){const ratio=devicePixelRatio||1,style=document.documentElement.style;style.setProperty('--burger-line',Math.max(1,Math.round(2*ratio))/ratio+'px');style.setProperty('--burger-gap',Math.max(1,Math.round(4*ratio))/ratio+'px');}
snapBurgerLines();addEventListener('resize',snapBurgerLines);
async function main(){
  const embedded=document.getElementById('development-config');
  const config=embedded?JSON.parse(embedded.textContent):await fetch('/development/config').then(r=>{if(!r.ok)throw Error('起動設定を取得できません。');return r.json();});
  document.title = `AiDiy ${config.linked ? 'IDE / ' : ''}${{cpu:'CPU',code:'Code',live:'Live',ide:'IDE',console:'Console',browser:'Browser',navi:'Navi'}[config.kind]}${config.kind==='console'&&config.cliName?' / '+config.cliName:''}`;
  createApp(App,{config}).provide('catppuccinIconBase',config.iconAssets||'/development/assets/catppuccin_icons/').mount('#app');
}
void main().catch(error=>{document.getElementById('app').textContent=error.message;});
