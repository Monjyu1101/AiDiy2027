<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, watch, nextTick, computed } from 'vue';
import 前回実行日時 from '../共通表示/前回実行日時.vue';
import 状態バッジ from '../共通表示/状態バッジ.vue';
import { 先頭へスクロール, 完了時 } from '../共通表示/先頭表示.mjs';
import { 外部連携表示を作成 } from './外部連携表示.mjs';
import './外部連携.css';
import 公式サイト from '../導入状況/公式サイト.json';
const props=defineProps(['lastRun','data','results','loading','testing','testingIds','batchBusy','connected','busy','writeBusy','written']);
defineEmits(['check','write','test']);
const { selected,items,row,result,config } = 外部連携表示を作成(props);
const グループ=computed(()=>[
 {id:'huggingface',名前:'公開モデル操作',項目:items.value.filter(item=>item.id.startsWith('huggingface'))},
 {id:'discord',名前:'Discord',項目:items.value.filter(item=>item.id==='discord')},
 {id:'slack',名前:'Slack',項目:items.value.filter(item=>item.id==='slack')},
].filter(group=>group.項目.length));
const サービス名=item=>item.id.startsWith('huggingface')?'Hugging Face'+(items.value.filter(row=>row.id.startsWith('huggingface')).length>1?(item.id.endsWith('read')?' 読取':' 書込'):''):item.id==='discord'?'Discord':item.id==='slack'?'Slack':item.名前;
const 行確認中=id=>props.testingIds?props.testingIds.has(id):props.testing===id;
const パネル=ref(null);
const 確認済み=computed(()=>items.value.some(item=>props.results?.[item.id] && !props.results[item.id].前回結果));
// 確認中の行が一覧で見える位置へスクロールし、状況確認が終わったら一覧・詳細を先頭（1項目目の表示）へスクロールする。
watch(()=>props.testing,async id=>{if(!id||!props.busy)return;await nextTick();パネル.value?.querySelector('.integration-row.selected')?.scrollIntoView({block:'center'});});
watch(()=>props.busy,完了時(()=>先頭へスクロール(パネル.value)));
</script>
<template>
<section ref="パネル" class="panel integration-panel" aria-label="外部連携">
 <div class="panel-heading"><h2>外部連携確認</h2><div class="panel-actions"><component :is="前回実行日時" :value="lastRun"/><button id="integration-run" :class="{'check-next': !確認済み}" :disabled="!connected || busy || loading || Boolean(testing) || writeBusy" title="設定状況を読み直し、テストできる行を上から順に認証確認します" @click="$emit('check')">{{busy?'確認中…':'状況確認'}}</button><button id="integration-write" :class="{'write-next': 確認済み && !written}" :disabled="!connected || busy || loading || Boolean(testing) || writeBusy || !確認済み" title="直前の確認結果を _AIDIY/aidiy_diag/integration_info.json に保存します" @click="$emit('write')">{{writeBusy?'書込中…':written?'書込済':'書込'}}</button></div></div>
 <main class="key-layout"><aside aria-label="外部連携の一覧">
  <p v-if="loading">設定状況を確認中…</p><p v-else-if="!data">接続すると設定状況を表示します。</p>
  <template v-else><p v-if="data.設定状態!=='読込済み'" role="status">設定ファイル: {{data.設定状態}}</p><p v-if="data.説明" role="status">{{data.説明}}</p>
   <section v-for="group in グループ" :key="group.id" class="integration-group"><div class="integration-group-heading"><span>{{group.名前}}</span><a class="integration-web" :href="公式サイト[group.id]" target="_blank" rel="noopener noreferrer" :aria-label="`${group.名前} の公式サイトを開く`">Web</a></div>
   <div v-for="item in group.項目" :key="item.id" class="integration-row" :class="{selected:selected===item.id}">
    <button class="key-select" :aria-pressed="selected===item.id" @click="selected=item.id"><span>{{サービス名(item)}}</span><span class="config-state">{{config(item)}}</span></button>
    <div class="integration-test"><button class="single-test-button" :disabled="!connected || busy || writeBusy || 行確認中(item.id) || batchBusy || loading || !item.テスト可能" :title="item.理由 || '読み取り専用の認証確認を1回行います'" @click="selected=item.id;$emit('test',item.id)">{{行確認中(item.id)?(results?.[item.id]?.状態==='待機中'?'待機中…':'確認中…'):'テスト'}}</button><component :is="状態バッジ" :state="results?.[item.id]?.状態 || '未実施'"/><span v-if="item.理由" class="integration-reason">{{item.理由}}</span></div>
   </div></section>
  </template>
 </aside>
 <article aria-live="polite"><template v-if="row"><span class="eyebrow">外部連携 / {{row.名前}}</span><h2>{{row.名前}}</h2><component :is="状態バッジ" class="status" :state="result?.状態 || '未実施'"/>
  <dl><dt>キー名</dt><dd>{{row.キー名}}</dd><dt>設定状況</dt><dd>{{config(row)}}</dd><dt>確認内容</dt><dd>{{row.説明}}</dd><dt>テスト</dt><dd>{{result?.説明 || row.理由 || '未実施。左側のテストボタンで認証を確認します。'}}</dd><dt>確認日時</dt><dd>{{result?.確認日時?new Date(result.確認日時).toLocaleString():'—'}}</dd></dl>
 </template><div v-else class="welcome"><span class="eyebrow">EXTERNAL INTEGRATIONS</span><h2>外部連携の設定状況</h2><p>Hugging Face・Discord・Slack を選択すると設定の有無と確認範囲を表示します。</p></div></article></main>
 <details class="test-notes"><summary>確認範囲について</summary><p>キーの値は表示しません。設定済は認証成功を意味しません。「状況確認」はテストできる行を上から順に、各行の「テスト」はその行だけを、読み取り専用で1回ずつ認証確認します（Hugging Face は whoami-v2、Discord は Bot 自身の情報の取得、Slack は auth.test による Bot トークンの認証）。キー未設定の行は確認せず未実施のままです。「書込」は直前の確認結果を _AIDIY/aidiy_diag/integration_info.json へ保存します。「全テスト」でも状況確認と書込を行います。</p><p>メッセージ送信・Gateway / Socket Mode 接続・リポジトリへの書込は行いません。Hugging Face 書込は、トークンに書込権限があるかを確認します。OK は認証と権限の確認で、個別のリポジトリ・チャンネルで実際に操作できることは保証しません。Slack の App トークン、workspace・user・channel の設定値、Socket Mode 接続、投稿権限はこの確認の対象外です。起動時・headless では確認しません。</p></details>
</section>
</template>
