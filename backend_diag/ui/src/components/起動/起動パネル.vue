<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {ref,watch,nextTick} from 'vue';
import './起動.css';
import {明滅値} from './明滅.mjs';
const props=defineProps({state:Object,online:Boolean,visible:Boolean});
const consoleView=ref(),targetTabs=ref();
watch([()=>props.state.コンソール.value,()=>props.visible,()=>props.state.選択.value],async()=>{await nextTick();if(props.visible&&consoleView.value)consoleView.value.scrollTop=consoleView.value.scrollHeight;});
watch(()=>props.state.選択.value,async()=>{await nextTick();if(props.visible)targetTabs.value?.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'nearest'});});
function tone(state){return state==='稼働中'?'running':state==='エラー'?'error':['起動中','再起動中','確認中','再起動待ち','停止中'].includes(state)?'busy':'idle';}
function 表示色(item){
 if(!props.online)return 'idle';
 if(props.state.停止警告対象.value.has(item.id))return 'stopped';
 const port=props.state.ポート項目.value.find(port=>port.id===item.id);
 return port?.開放===true?'running':port?.開放===false&&item.状態==='稼働中'?'idle':tone(item.状態);
}
</script>
<template>
<section class="panel start-panel" v-show="visible" aria-label="システム起動管理">
 <div class="panel-heading"><div><h2>システム起動</h2><p>すべて未起動なら「一括起動」、稼働中の機能があれば「強制停止」でタブの逆順に停止します。</p></div><div class="start-view-actions"><span class="start-save" role="status">{{state.保存表示.value}}</span></div></div>
 <nav ref="targetTabs" class="start-targets" aria-label="起動する機能">
  <button v-for="(item,index) in state.項目.value" :key="item.id" :class="{active:state.選択.value===item.id}" :data-tone="表示色(item)" :title="state.停止警告対象.value.has(item.id)?'起動対象ですが、現在ポートが閉じています':''" :style="明滅値(index,'start')" :aria-pressed="state.選択.value===item.id" @click="state.選択.value=item.id"><span class="start-dot" :data-tone="表示色(item)"></span>{{item.名前}}<span v-if="item.設定.起動対象" class="start-enabled" title="一括起動の対象">✓</span></button>
 </nav>
 <div v-if="state.読込中.value" class="start-empty">起動設定を読み込んでいます…</div>
 <div v-else-if="!state.選択対象.value" class="start-empty">診断に接続すると、起動する機能を設定できます。</div>
 <template v-else>
  <div class="start-settings">
   <div v-for="(value,key) in state.選択対象.value.設定" :key="key" class="start-setting"><label><input type="checkbox" :checked="value" :disabled="!online||state.保存中.value" @change="state.設定変更(state.選択.value,key,$event.target.checked)">{{key==='ブラウザ表示'?'ブラウザで開く':key}}</label><button v-if="key==='ブラウザ表示'" class="start-open-browser" :disabled="!online||!state.ブラウザ起動可能.value||state.ブラウザ起動中.value" @click="state.ブラウザで開く()">{{state.ブラウザ起動中.value?'開いています…':'手動で開く'}}</button></div>
   <span class="start-path">{{state.選択対象.value.フォルダ}}/_start.py</span>
  </div>
  <p v-if="state.選択.value==='web'" class="start-help">「ブラウザで開く」がオンの場合、HTTP 応答が20秒間安定してから開きます。「手動で開く」は Tools / MCP と Web の両方が稼働中のときに使えます。一括起動のブラウザ表示にも Tools / MCP が必要です。</p>
  <p v-if="state.選択.value==='web'&&state.ブラウザ通知.value" class="start-message" role="status">{{state.ブラウザ通知.value}}</p>
  <div class="start-console-heading"><strong>{{state.選択対象.value.名前}} コンソール</strong><span class="start-status" :data-tone="tone(state.選択対象.value.状態)">{{state.選択対象.value.状態}}</span><div class="start-console-actions"><button :disabled="!online||state.保存中.value||state.処理中.value||state.起動中.value" @click="state.再起動(state.選択.value)">再起動</button><button :disabled="!online||state.処理中.value" @click="state.停止()">停止（Ctrl+C）</button></div></div>
  <pre ref="consoleView" class="start-console" tabindex="0" role="log" :aria-label="state.選択対象.value.名前+' のログ。文字を選択してコピーできます'">{{state.コンソール.value}}</pre>
  <p class="start-help">ログを選択して Ctrl+C（Mac は ⌘C）でコピー。停止ボタンから Ctrl+C を送信します。設定変更は自動保存されます。</p>
 </template>
 <p v-if="state.通知.value" class="start-message" role="status">{{state.通知.value}}</p>
</section>
</template>
