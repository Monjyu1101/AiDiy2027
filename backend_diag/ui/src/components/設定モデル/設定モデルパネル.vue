<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { 先頭へスクロール, 完了時 } from '../共通表示/先頭表示.mjs';
import { 再生可能な音声 } from './設定モデル音声.mjs';
import 状態バッジ from '../共通表示/状態バッジ.vue';
import './設定モデル.css';
const props=defineProps(['data','results','loading','running','selected','online','message','audioStates','visible']);
defineEmits(['refresh','start','test','cancel','select','audio-load','audio-error']);
const items=computed(()=>props.data?.項目||[]);
const row=computed(()=>items.value.find(item=>item.id===props.selected));
const result=computed(()=>props.results?.[props.selected]);
const audio=computed(()=>row.value?.id==='LIVE'?再生可能な音声(result.value):null);
const audioState=computed(()=>props.audioStates?.[audio.value?.id]);
const 状態=item=>props.results?.[item.id]?.状態 || (item.状態==='未実行'?'未実施':item.状態) || '未実施';
const 実行済み=item=>Boolean(props.results?.[item.id]) && props.results[item.id].状態!=='実行中';
const 名前=item=>`${item.区分 || item.id}${item.役割 ? ` / ${item.役割}` : ''}`;
const 区分名={CHAT:'チャット',LIVE:'ライブ',PREDICTION:'入力予測',DECISION:'判断',CODE:'コード',TASK:'タスク',TEAM:'チーム'};
// 左の一覧は区分ごとに見出しを付け、チャット・ライブ・入力予測・判断・コード・タスク・チームの順に並べる。
const グループ=computed(()=>{
 const groups=new Map(Object.keys(区分名).map(key=>[key,[]]));
 for(const item of items.value){const key=item.区分||'その他';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
 return [...groups].filter(([,rows])=>rows.length).map(([key,rows])=>({key,名前:区分名[key]||key,項目:rows}));
});
const パネル=ref(null);
// 動作確認中は、確認している行が左の一覧で見える位置へ随時スクロールする。
watch(()=>props.selected,async()=>{if(!props.running)return;await nextTick();パネル.value?.querySelector?.('.trial-row.selected')?.scrollIntoView({block:'center'});});
// 動作確認が終わって先頭行へ戻ったら、一覧・詳細を先頭までスクロールする。
watch(()=>props.running,完了時(()=>{if(props.selected===items.value[0]?.id)先頭へスクロール(パネル.value);}));
</script>
<template>
<section ref="パネル" class="panel model-trial-panel" aria-label="設定モデル">
 <div class="panel-heading trial-heading"><div class="heading-title"><h2>モデル動作確認</h2><button class="trial-reload refresh-button" aria-label="設定モデルを再読込" :aria-busy="loading" :disabled="!online || loading || running" title="設定中のモデルを読み直します" @click="$emit('refresh')"><span class="refresh-glyph" aria-hidden="true">↺</span><span>再読込</span></button></div><div class="panel-actions trial-actions"><button id="model-trial-start" :class="{'check-next': !items.some(実行済み)}" :disabled="!online || loading || running || !items.length" @click="$emit('start')">動作確認</button><button :disabled="!running" @click="$emit('cancel')">中止</button></div></div>
 <p class="panel-note">設定中のモデルで短い応答を確認します。未導入のCLIはテストせず「未実施」のままにします。試行は料金が発生する場合があります。同じ接続経路・プロバイダ・モデル・音声設定の試行結果はサーバーで共有します。</p>
 <p v-if="!online" class="panel-note warning" role="status">Tools 接続時に利用できます。</p>
 <p v-else-if="message" class="panel-note" role="status" aria-live="polite">{{message}}</p>
 <main class="trial-layout"><aside aria-label="設定モデル一覧"><p v-if="loading">設定を読込中…</p><p v-else-if="!items.length">設定項目がありません。設定を再読込してください。</p>
  <section v-for="group in グループ" :key="group.key" class="trial-group" :aria-label="group.名前"><h3 class="trial-group-title">{{group.名前}}<span> · {{group.項目.length}}</span></h3>
  <div v-for="item in group.項目" :key="item.id" class="trial-row" :class="{selected:selected===item.id}">
   <button class="trial-select" :aria-pressed="selected===item.id" @click="$emit('select',item.id)"><strong>{{名前(item)}}</strong><span class="trial-model">{{item.プロバイダ || '未設定'}} / {{item.モデル || '未設定'}}</span><span v-if="results?.[item.id]?.共有元" class="trial-share">共有元: {{results[item.id].共有元}}</span></button>
   <div class="trial-test"><button class="single-test-button" :data-trial-id="item.id" :aria-label="`${名前(item)}をテスト`" :disabled="!online || loading || running || (item.id==='PREDICTION' && !data?.予測条件?.テスト可能)" :title="item.id==='PREDICTION'?data?.予測条件?.説明:undefined" @click="$emit('select',item.id);$emit('test',item.id)">テスト</button><component :is="状態バッジ" :state="状態(item)" :label="状態(item)==='実行中'?'テスト中':''"/></div>
  </div>
  </section>
 </aside><article aria-live="polite"><template v-if="row"><span class="eyebrow">設定モデル / {{row.id}}</span><h2>{{名前(row)}}</h2><component :is="状態バッジ" class="status" :state="状態(row)" :label="状態(row)==='実行中'?'テスト中':''"/><dl><dt>プロバイダ</dt><dd>{{row.プロバイダ || '未設定'}}</dd><dt>設定モデル</dt><dd>{{row.モデル || '未設定'}}</dd><dt>確認経路</dt><dd>{{row.id==='LIVE'?'Tools 内部 HTTP（Live）':row.id==='PREDICTION'?'Tools 内部 HTTP（Prediction・MCP非公開）':'Tools MCP'}}</dd><template v-if="row.id==='PREDICTION'"><dt>予測モデル</dt><dd>{{data?.予測条件?.プロバイダ || '未取得'}} / {{data?.予測条件?.モデル || '未取得'}}</dd><dt>対象プロジェクト</dt><dd>{{data?.予測条件?.プロジェクト || '未設定'}}</dd><dt>実行条件</dt><dd>{{data?.予測条件?.説明 || '同じプロバイダ・モデルのChat成功を確認済みです。'}}</dd></template><template v-if="row.音声"><dt>音声</dt><dd>{{row.音声}}</dd></template><template v-if="row.継承元"><dt>設定の継承元</dt><dd>{{row.継承元}}</dd></template><template v-if="row.id==='DECISION'"><dt>判断入力</dt><dd>おはよう</dd><dt>選択肢</dt><dd>high / medium / low（挨拶の丁寧さ）</dd><dt>判断結果</dt><dd>{{result?.判断結果 || '未取得'}}</dd></template><dt>結果</dt><dd>{{result?.説明 || (result?.状態==='OK'?'応答を確認しました。':result?.状態==='実行中'?'確認中…':row.説明 || '未実施')}}</dd><template v-if="result?.実行モデル"><dt>実行モデル</dt><dd>{{result.実行モデル}}</dd></template><template v-if="result?.共有元"><dt>共有元</dt><dd>{{result.共有元}}（同じ接続経路・プロバイダ・モデル・音声設定の試行結果）</dd></template><template v-if="result?.所要ms!=null"><dt>所要時間</dt><dd>{{result.所要ms}} ms</dd></template></dl><h3>応答</h3><pre class="trial-reply">{{String(result?.応答 || '応答はまだありません。').slice(0,4000)}}</pre><section v-if="audio" class="trial-audio" aria-label="Live 応答音声"><h3>応答音声（{{(audio.長さms/1000).toFixed(2)}} 秒）</h3><p>一時保存した音声です。再生ボタンで確認できます。</p><audio v-if="audioState?.url && visible!==false" :key="audio.id" :src="audioState.url" controls preload="none" aria-label="Live 応答音声の再生" @error="$emit('audio-error',audio.id)"></audio><span v-if="!audioState?.url && !audioState?.エラー">音声を準備中…</span><button v-if="audioState?.エラー" class="refresh-button" :aria-busy="Boolean(audioState?.読込中)" :disabled="!online || audioState?.読込中" @click="$emit('audio-load',result)"><span class="refresh-glyph" aria-hidden="true">↺</span><span>音声取得を再試行</span></button><p v-if="audioState?.エラー" class="warning" role="status">{{audioState.エラー}}</p></section></template><div v-else class="welcome"><h2>設定モデルの試行</h2><p>一覧から選択して詳細を確認できます。各項目の「テスト」または「動作確認」で開始します。</p></div></article></main>
 <details class="test-notes"><summary>試行について</summary><p>Chat・Decision・Code・Task・Team は MCP、Live・Prediction は Tools 内部 HTTP を使います。診断サーバー経由で確認し、API キーは画面に送信しません。起動時や「全テスト」では試行しません。未設定・未対応は成功扱いにしません。設定変更や切断後は再読込して試行してください。</p><p>Chat・Code系は実際の入力と応答の履歴保存まで確認します。PredictionはChatテスト成功後に実行でき、OKになったChatのモデルで「昔々、あるところに」「おじいさんと」の2ターンを送って履歴保存を確認してから、CODE_BASE_PATHの同一プロジェクトの直近2時間・最大10ターンを読んで予測します。「おばあさん」が返れば完璧です。予測結果は履歴に保存しません。履歴なし・空応答・エラーはNG、正常な非空応答は!・！を含む説明でもOKです。</p><p>中止後も、サービス側ですでに開始した処理や料金は取り消せない場合があります。</p></details>
</section>
</template>
