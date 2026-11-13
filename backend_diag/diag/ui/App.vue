<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import 導入状況パネル from './components/導入状況/導入状況パネル.vue';
import { 導入状況状態を作成 } from './components/導入状況/導入状況状態.mjs';
import { 導入操作状態を作成 } from './components/導入状況/導入操作状態.mjs';
import モデル一覧パネル from './components/モデル一覧/モデル一覧パネル.vue';
import 外部連携パネル from './components/外部連携/外部連携パネル.vue';
import { キー設定状態を作成 } from './components/キー設定共通/キー設定状態.mjs';
import 設定モデルパネル from './components/設定モデル/設定モデルパネル.vue';
import { 設定モデル状態を作成 } from './components/設定モデル/設定モデル状態.mjs';
import AIモデルパネル from './components/AIモデル/AIモデルパネル.vue';
import AI設定パネル from './components/AI設定/AI設定パネル.vue';
import Toolsパネル from './components/Tools/Toolsパネル.vue';
import {AIモデル状態を作成} from './components/AIモデル/AIモデル状態.mjs';
import ステータスバー from './components/ウィンドウ/ステータスバー.vue';
import {Tools接続を作成} from './components/ウィンドウ/Tools接続.mjs';
import アプリ起動パネル from './components/アプリ起動/アプリ起動パネル.vue';
import {アプリ状態を作成} from './components/アプリ起動/アプリ状態.mjs';
import {CLI状態を作成} from './components/アプリ起動/CLI状態.mjs';
import 起動パネル from './components/起動/起動パネル.vue';
import {起動状態を作成} from './components/起動/起動状態.mjs';
import {自動起動表示を作成} from './components/起動/自動起動表示.mjs';
import 一括進捗表示 from './components/起動/一括進捗表示.vue';
import 起動ミニパネル from './components/起動/起動ミニパネル.vue';
import マイクロランチャー from './components/アプリ起動/マイクロランチャー.vue';
import {起動ミニ表示を作成} from './components/ウィンドウ/起動ミニ表示.mjs';
import {認証セッションを作成} from '../../shared/ui/認証セッション.mjs';
const パネル折畳み=ref(false),パネル非表示=ref(false),パネル表示世代=ref(0),パネル要素=ref();
import {表示切替前にパネルを開く} from './components/ウィンドウ/表示切替準備.mjs';
const 認証セッション=認証セッションを作成({location});
const tab=ref('start'), key=ref(認証セッション.初期キー), input=ref('');
if(location.hash) history.replaceState(null,'',location.pathname+location.search);
const connected=ref(false),connecting=ref(false);
const message=ref('ローカル環境の外部プログラムを確認します。');
const 操作中=ref(false),全診断中=ref(false);
const { 前回実行日時, 確認中, 個別確認中, 個別確認IDs, 確認済み, 書込中, 書込済み, 表示中, 項目, 結果, 調査, 一覧を反映, 状況確認, 個別確認, 操作結果を反映, 書込, 全テスト } = 導入状況状態を作成({ api, 接続済み: connected, 通知: message, 操作中, 確認後:()=>導入操作.読込() });
const 導入操作=導入操作状態を作成({api,接続済み:connected,操作中,競合中:()=>確認中.value||Boolean(個別確認中.value)||書込中.value||全診断中.value,結果反映:操作結果を反映});
watch(connected,value=>{void 導入操作.接続(value);},{flush:'sync'});
const { modelLastRun,integrationLastRun,keyData,keyBusy,keyTesting,keyTestingIds,keyResults,latestBusy,modelWriteBusy,modelWritten,integrationBusy,integrationWriteBusy,integrationWritten,publicModels,publicBusy,loadKeys,testKey,一覧再取得,モデル書込,外部連携確認,外部連携書込,refreshPublic,resetPublic,設定を破棄,終了 } = キー設定状態を作成({ api, connected, message });
const toolsOnline=ref(false),toolsChecking=ref(false);
const tools=Tools接続を作成({api,反映:state=>{toolsOnline.value=state.online;toolsChecking.value=state.checking;}});
const 起動=起動状態を作成({api});
const 自動起動表示=自動起動表示を作成({tab,接続済み:connected});
watch(起動.自動起動完了,progress=>自動起動表示.反映(progress));
const アプリ=アプリ状態を作成({api});
let memoSync=Promise.resolve();
watch([connected,アプリ.フォルダ],([online,selected],[,previous])=>{
 // 初期一覧の取得前の空欄で、設定済みプロジェクトを消さない。
 if(!online||!selected&&!previous)return;
 const folder=アプリ.起動フォルダ();
 memoSync=memoSync.catch(()=>{}).then(()=>api('api/メモ/プロジェクト','POST',undefined,'json',{フォルダ:folder})).catch(error=>{message.value='メモ: '+error.message;});
});
async function メモを開く(){
 // プロジェクト選択の反映後、既存の編集内容は再読込せず新規を追加する。
 if(window.aidiyWindow?.openMemo){await memoSync;try{await window.aidiyWindow.openMemo(true);}catch{message.value='メモを開けませんでした。';}return;}
 const target=window.open('','aidiy-memo');
 if(!target){message.value='メモを開くにはポップアップを許可してください。';return;}
 await memoSync;
 try{if(target.location.origin===location.origin&&target.location.pathname.endsWith('/memo.html')){target.postMessage({type:'aidiy-memo-new'},location.origin);target.focus();return;}}catch{}
 const url=new URL('memo.html',location.href);url.hash=new URLSearchParams({token:key.value,new:'1'}).toString();target.location.href=url.href;
}

const CLI=CLI状態を作成({api,アプリ,接続可能:()=>connected.value});
const ミニ=起動ミニ表示を作成({利用可能:()=>connected.value,初期表示:globalThis.window?.aidiyWindow?.initialMini===true&&globalThis.performance?.getEntriesByType('navigation')[0]?.type!=='reload'});
const マイクロ表示=ref(false),マイクロ切替中=ref(false);
const ミニ表示=computed(()=>ミニ.表示中.value||マイクロ表示.value);
async function 表示切替(mode){
 自動起動表示.利用者操作();
 if(マイクロ切替中.value||ミニ.切替中.value||パネル折畳み.value&&!パネル非表示.value)return false;
 if(mode==='micro'&&(!connected.value||!アプリ.フォルダ.value))return false;
 マイクロ切替中.value=true;
 let transition=false;
 try{
  if(パネル折畳み.value&&!await 表示切替前にパネルを開く({折畳み:パネル折畳み,非表示:パネル非表示,世代:パネル表示世代,要素:パネル要素,api:window.aidiyWindow,nextTick}))return false;
  if(window.aidiyWindow?.beginDisplay){if(await window.aidiyWindow.beginDisplay(mode)!==true)return false;transition=true;}
  if(マイクロ表示.value){if(window.aidiyWindow&&await window.aidiyWindow.startMicro(false)!==true)return false;マイクロ表示.value=false;await nextTick();}
  if(!await ミニ.変更(mode==='mini'))return false;
  if(mode==='micro'){
   if(window.aidiyWindow&&await window.aidiyWindow.startMicro(true)!==true)throw Error('アイコン化に切り替えられませんでした。');
   マイクロ表示.value=true;
  }
  return true;
 }catch(error){message.value=error.message;return false;}finally{
  await nextTick();
  try{if(transition)await window.aidiyWindow.finishDisplay();}finally{マイクロ切替中.value=false;}
 }
}
watch([connected,アプリ.フォルダ],()=>{if(マイクロ表示.value&&(!connected.value||!アプリ.フォルダ.value))void 表示切替('normal');});
watch([tab,connected,ミニ表示],([value,online,mini])=>{起動.表示(online,value==='start'&&!mini);if(!online){CLI.切断();void ミニ.変更(false);}});
watch(ミニ.エラー,error=>{if(error)message.value=error;});
function コンソールへ戻る(id){自動起動表示.利用者操作();起動.選択.value=id;tab.value='start';void 表示切替('normal');}
function アプリ起動へ戻る(){自動起動表示.利用者操作();tab.value='apps';void 表示切替('normal');}
const 手動=AIモデル状態を作成({api,接続可能:()=>connected.value&&toolsOnline.value});
watch(tab,(value,old)=>{if(old==='manual')手動.表示を離れる();if(old==='trials')試行.表示を離れる();},{flush:'sync'});
const 試行=設定モデル状態を作成({api,接続可能:()=>connected.value&&toolsOnline.value});
const {設定:試行設定,結果:試行結果,読込中:試行読込中,実行中:試行実行中,選択:試行選択,通知:試行通知,音声状態:試行音声}=試行;
watch(connected,value=>{tools.接続(value);アプリ.接続(value);});
watch(()=>connected.value&&toolsOnline.value,value=>{if(!value){試行.切断();手動.中止();}else if(tab.value==='trials')void 試行.読込();else if(tab.value==='manual')void 手動.読込();},{flush:'sync'});
onUnmounted(()=>{導入操作.終了();手動.終了();試行.終了();終了();tools.終了();アプリ.終了();起動.終了();void ミニ.変更(false);});
async function api(path,method='GET',signal,format='json',body) {
 const requestKey=key.value;
 const response=await fetch(new URL(path,location.href),{method,signal,headers:{Authorization:`Bearer ${requestKey}`,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'same-origin'});
 if(response.ok && format==='blob')return response.blob();
 if(response.status===401&&key.value===requestKey){認証セッション.破棄();設定を破棄();key.value='';connected.value=false;}
 const data=await response.json();
 if(!response.ok){throw new Error(data.エラー || '通信に失敗しました。');}
 return data;
}
async function connect(){if(connecting.value)return;connecting.value=true;try{const data=await api('api/一覧');一覧を反映(data);resetPublic();認証セッション.保存(key.value);connected.value=true;message.value='';if(tab.value==='keys'||tab.value==='integrations')await loadKeys();}catch(error){message.value=error.message;void ミニ.変更(false);}finally{connecting.value=false;}}
function submit(){if(connecting.value)return;認証セッション.破棄();key.value=input.value.trim();input.value='';connect();}
// 全テスト: 状況確認→書込、続けて一覧再取得→モデル情報の書込。
// 実行中の処理に合わせて、導入状況→モデル一覧→外部連携の順に表示タブを切り替え、終わったら導入状況タブへ戻す。
async function 全診断(){if(!connected.value||操作中.value||全診断中.value||確認中.value||個別確認中.value||書込中.value||keyBusy.value||keyTesting.value||latestBusy.value||integrationBusy.value||modelWriteBusy.value||integrationWriteBusy.value)return;全診断中.value=true;try{tab.value='install';if(!await 全テスト())return;tab.value='keys';await 一覧再取得();await モデル書込();tab.value='integrations';await 外部連携確認({再読込:false});await 外部連携書込();tab.value='install';}finally{全診断中.value=false;}}
async function changeTab(value){if(['settings','tools'].includes(value)&&(!connected.value||!起動.Core利用可能.value))return;if(value==='tools'&&!toolsOnline.value)return;if(['trials','manual'].includes(value)&&(!connected.value||!toolsOnline.value))return;自動起動表示.利用者操作();tab.value=value;if(value==='start'||value==='apps'||value==='settings'||value==='tools')return;if(value==='manual'){if(!手動.一覧.value)await 手動.読込();return;}if(value==='trials'){if(!試行設定.value)await 試行.読込();}else if(value!=='install' && !keyData.value)await loadKeys();}
onMounted(()=>{if(key.value)connect();});
</script>
<template>
<div ref="パネル要素" class="diag-panel ai-component" :class="{'diag-panel-hidden':パネル非表示}" :data-collapsed="パネル折畳み">
<component v-if="!マイクロ表示" :is="ステータスバー" :key="パネル表示世代" :server-state="connected?起動.サーバー表示状態.value:'unknown'" :connected="connected" :compact="ミニ表示" :micro-available="!!アプリ.フォルダ.value" :collapsed="パネル折畳み" :hidden="パネル非表示" @toggle="パネル折畳み=!パネル折畳み" @hidden="パネル非表示=$event" :switching="(パネル折畳み&&!パネル非表示)||ミニ.切替中.value||マイクロ切替中" @memo="メモを開く" @mini="表示切替('mini')" @micro="表示切替('micro')" @restore="表示切替('normal')"/>
<component v-if="マイクロ表示" :is="マイクロランチャー" :app-state="アプリ" :cli-state="CLI" :state="起動" :online="connected" :switching="マイクロ切替中" @restore="表示切替('normal')" @mini="表示切替('mini')" @select="コンソールへ戻る"/>
<nav class="tabs" @pointerdown.capture="自動起動表示.利用者操作" @keydown.capture="自動起動表示.利用者操作" v-show="!ミニ表示" aria-label="診断の種類"><button class="tab-headless" :aria-pressed="tab==='install'" :class="{active:tab==='install'}" @click="changeTab('install')">導入状況</button><button class="tab-headless" :aria-pressed="tab==='keys'" :class="{active:tab==='keys'}" @click="changeTab('keys')">モデル一覧</button><button class="tab-headless" :aria-pressed="tab==='integrations'" :class="{active:tab==='integrations'}" @click="changeTab('integrations')">外部連携</button><button class="tab-model" :aria-pressed="tab==='trials'" :class="{active:tab==='trials'}" :disabled="!connected || !toolsOnline" title="Tools 接続時に利用できます" @click="changeTab('trials')">設定モデル</button><button class="tab-model" :aria-pressed="tab==='manual'" :class="{active:tab==='manual'}" :disabled="!connected || !toolsOnline" @click="changeTab('manual')">AIモデル</button><button class="tab-settings" :aria-pressed="tab==='settings'" :class="{active:tab==='settings'}" :disabled="!connected || !起動.Core利用可能.value" title="Core 起動中のみ利用できます" @click="changeTab('settings')">設定再起動</button><button class="tab-tools" :aria-pressed="tab==='tools'" :class="{active:tab==='tools'}" :disabled="!connected || !起動.Core利用可能.value || !toolsOnline" title="Core と Tools の起動・Coreログインが必要です" @click="changeTab('tools')">Tools</button><button class="tab-launch" :aria-pressed="tab==='start'" :class="{active:tab==='start'}" @click="changeTab('start')">システム起動</button><button class="tab-launch" :aria-pressed="tab==='apps'" :class="{active:tab==='apps'}" @click="changeTab('apps')">アプリ起動</button><button id="run" class="run-all" :class="{'force-stop':tab==='start'&&起動.稼働あり.value}" v-show="tab!=='apps'&&tab!=='settings'&&tab!=='tools'" :disabled="tab==='start'?(!connected||起動.読込中.value||起動.保存中.value||起動.処理中.value||起動.一括停止中.value||(!起動.稼働あり.value&&!起動.設定起動可能.value)):!connected || 操作中 || 全診断中 || 確認中 || Boolean(個別確認中) || keyBusy || Boolean(keyTesting) || 書込中 || latestBusy || modelWriteBusy || integrationBusy || integrationWriteBusy || (tab==='manual' && (!toolsOnline || 手動.実行中.value || 手動.読込中.value || !手動.一覧.value))" @click="tab==='start'?起動.一括操作():tab==='manual'?手動.開始(true):全診断()" :title="tab==='start'?(起動.稼働あり.value?'稼働中の機能をタブの逆順に停止します':'選択した機能をタブの順に起動します'):tab==='manual'?'Chat→Live→Prediction→Decision→Codeを順に試行します':'導入状況・モデル一覧・外部連携を順に確認し、結果を書き込みます'">{{tab==='start'?(起動.一括停止中.value?'強制停止中…':起動.処理中.value&&起動.進捗表示.value?.状態==='running'?(起動.進捗表示.value.種別==='stop'?'強制停止中…':'一括起動中…'):起動.稼働あり.value?'強制停止':'一括起動'):tab==='manual'?(手動.実行中.value?'実行中…':'一括試行'):確認中 || 個別確認中 || integrationBusy ? '確認中…' : 書込中 || modelWriteBusy || integrationWriteBusy ? '書込中…' : latestBusy ? '取得中…' : '全テスト'}}</button></nav>
<component v-if="connected&&!ミニ表示" :is="一括進捗表示" :state="起動"/>
<section v-if="!connected&&!ミニ表示" id="login" class="login"><label for="token">起動したターミナルの認証 URL を開くか、認証キーを入力してください。</label><form @submit.prevent="submit"><input id="token" v-model="input" :disabled="connecting" type="password" autocomplete="off" placeholder="起動中のみ有効な認証キー"><button id="connect" :disabled="connecting">接続</button></form></section>
<p v-if="message" id="message" role="status" aria-live="polite" v-show="!ミニ表示">{{message}}</p>
<component :is="導入状況パネル" :last-run="前回実行日時" v-show="tab==='install'&&!ミニ表示" :項目="項目" :結果="結果" :確認中="確認中" :個別確認中="個別確認中" :個別確認-ids="個別確認IDs" :接続済み="connected" :確認済み="確認済み" :書込中="書込中" :書込済み="書込済み" :表示中="表示中" :操作="導入操作" :操作中="操作中" :全診断中="全診断中" @確認="状況確認" @個別確認="個別確認" @書込="書込"/>
<component :is="モデル一覧パネル" :last-run="modelLastRun" v-show="tab==='keys'&&!ミニ表示" :data="keyData" :results="keyResults" :loading="keyBusy" :testing="keyTesting" :testing-ids="keyTestingIds" :batch-busy="latestBusy || integrationBusy" :connected="connected" :public-models="publicModels" :public-busy="publicBusy" :latest-busy="latestBusy" :write-busy="modelWriteBusy" :written="modelWritten" @latest="一覧再取得" @write="モデル書込" @refresh-public="refreshPublic" @test="testKey"/>
<component :is="外部連携パネル" :last-run="integrationLastRun" v-show="tab==='integrations'&&!ミニ表示" :data="keyData" :results="keyResults" :loading="keyBusy" :testing="keyTesting" :testing-ids="keyTestingIds" :batch-busy="latestBusy || integrationBusy" :connected="connected" :busy="integrationBusy" :write-busy="integrationWriteBusy" :written="integrationWritten" @check="外部連携確認" @write="外部連携書込" @test="testKey"/>
<component :is="設定モデルパネル" v-show="tab==='trials'&&!ミニ表示" :data="試行設定" :results="試行結果" :loading="試行読込中" :running="試行実行中" :selected="試行選択" :online="connected && toolsOnline" :message="試行通知" :audio-states="試行音声" :visible="tab==='trials'&&!ミニ表示" @audio-load="試行.音声読込" @audio-error="試行.音声再生失敗" @refresh="試行.読込" @start="試行.開始()" @test="試行.個別開始($event)" @cancel="試行.中止()" @select="試行選択=$event"/>
<component :is="AIモデルパネル" v-show="tab==='manual'&&!ミニ表示" :state="手動" :online="connected && toolsOnline" :visible="tab==='manual'&&!ミニ表示"/>
<component :is="アプリ起動パネル" :state="アプリ" :cli-state="CLI" :online="connected" :visible="tab==='apps'&&!ミニ表示"/>
<component :is="起動パネル" @pointerdown.capture="自動起動表示.利用者操作" @keydown.capture="自動起動表示.利用者操作" :state="起動" :online="connected" :visible="tab==='start'&&!ミニ表示"/>
<component v-if="ミニ.表示中.value&&!マイクロ表示" :is="起動ミニパネル" :app-state="アプリ" :cli-state="CLI" :app-online="connected" :state="起動" :online="connected&&!起動.更新失敗.value" @select="コンソールへ戻る" @open-apps="アプリ起動へ戻る"/>
<Toolsパネル v-if="connected" v-show="tab==='tools'&&!ミニ表示" :api="api" :connected="connected" :core-online="起動.Core利用可能.value" :tools-online="toolsOnline" :visible="tab==='tools'&&!ミニ表示"/>
<AI設定パネル v-if="connected" v-show="tab==='settings'&&!ミニ表示" :api="api" :connected="connected" :core-online="起動.Core利用可能.value"/>
<footer v-show="!ミニ表示"><div class="diag-meta"><span>診断 {{connected?'接続済':'未接続'}}</span><span>tools {{toolsOnline?'オンライン':'オフライン'}}</span></div><p id="coverage" v-if="調査.sourceTargetFiles">調査{{調査.complete ? '完了':'途中'}}: 対象ソース・設定 {{Number(調査.scannedSourceFiles || 0).toLocaleString()}} / {{Number(調査.sourceTargetFiles).toLocaleString()}} 件 · {{項目.length}} 項目 · {{String(調査.commit || '').slice(0,8)}}。通常の Markdown 本文・画像・音声・モデル等は除外。</p><p v-else>ソース調査情報は接続後に表示します。</p>対象はこの診断サーバーの実行環境です。存在確認は動作・認証・接続の保証ではありません。</footer>
</div>
</template>
