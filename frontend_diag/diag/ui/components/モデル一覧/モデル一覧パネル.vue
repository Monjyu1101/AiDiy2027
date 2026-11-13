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
import { モデル一覧表示を作成 } from './モデル一覧表示.mjs';
import './モデル一覧.css';
const props=defineProps(['lastRun','data','results','loading','testing','testingIds','batchBusy','connected','publicModels','publicBusy','latestBusy','writeBusy','written']);
defineEmits(['latest','write','refresh-public','test']);
const { selected,items,row,result,config,公開状態,確認内容 } = モデル一覧表示を作成(props);
const 行確認中=id=>props.testingIds?props.testingIds.has(id):props.testing===id;
const パネル=ref(null);
const 確認済み=computed(()=>items.value.some(item=>props.results?.[item.id] && !props.results[item.id].前回結果));
// 取得中の行が一覧で見える位置へスクロールする。
watch(()=>props.testing,async id=>{if(!id||!props.latestBusy)return;await nextTick();document.querySelector('.model-key-panel .key-row.selected')?.scrollIntoView({block:'center'});});
// 一覧再取得が終わったら、一覧・詳細を先頭（1項目目の表示）へスクロールする。
watch(()=>props.latestBusy,完了時(()=>先頭へスクロール(パネル.value)));
</script>
<template>
<section ref="パネル" class="panel model-key-panel" aria-label="モデル一覧"><div class="panel-heading"><div class="heading-title"><h2>モデル一覧取得</h2><span class="public-status" :title="publicModels?.説明 || ''">公開モデル一覧取得: <component :is="状態バッジ" class="public-indicator" :state="公開状態"/><button v-if="公開状態==='キャッシュ利用'" class="public-retry refresh-button" title="公開モデル一覧をネットワークから再取得します" aria-label="公開モデル一覧を再取得" :aria-busy="publicBusy" :disabled="!connected || publicBusy" @click="$emit('refresh-public')"><span class="refresh-glyph" aria-hidden="true">↺</span><span>再取得</span></button></span></div><div class="panel-actions"><component :is="前回実行日時" :value="lastRun"/><button id="latest-models" :aria-busy="latestBusy" :class="{'check-next': !確認済み}" :disabled="!connected || loading || Boolean(testing) || latestBusy" title="設定状況を読み直し、テストできる各キーでモデル一覧を取得します" @click="$emit('latest')">{{latestBusy?'取得中…':'一括取得'}}</button><button id="models-write" :class="{'write-next': 確認済み && !written}" :disabled="!connected || loading || Boolean(testing) || latestBusy || writeBusy || !確認済み" title="取得したモデル一覧を _AIDIY/aidiy_diag/（プロバイダ）_models_info.json に保存します" @click="$emit('write')">{{writeBusy?'書込中…':written?'書込済':'書込'}}</button></div></div>
<p v-if="publicModels?.状態==='失敗'" class="panel-note warning" role="status">{{publicModels.説明 || '公開モデルを取得できませんでした。再取得できます。'}}</p><main class="key-layout"><aside aria-label="キーの一覧"><p v-if="loading">設定状況を確認中…</p><p v-else-if="!data">接続すると設定状況を表示します。</p><template v-else><p v-if="data.設定状態!=='読込済み'" role="status">設定ファイル: {{data.設定状態}}</p><p v-if="data.説明" role="status">{{data.説明}}</p><div v-for="item in items" :key="item.id" class="key-row" :class="{selected:selected===item.id}"><button class="key-select" :aria-pressed="selected===item.id" @click="selected=item.id"><span>{{item.名前}}</span><span class="config-state">{{config(item)}}</span></button><div class="key-test"><button class="single-test-button" :disabled="!connected || 行確認中(item.id) || batchBusy || loading || !item.テスト可能" :title="item.ローカル ? (item.id==='local' ? 'backend_local の固定候補を確認します' : 'ローカルの Ollama からモデル一覧を取得します') : item.キー不要 ? '取得済み公開モデルを表示します。キーの有効性は確認しません。' : item.理由 || 'このキーでモデル一覧を取得します'" @click="selected=item.id;$emit('test',item.id)">{{行確認中(item.id)?(results?.[item.id]?.状態==='待機中'?'待機中…':'確認中…'):'テスト'}}</button><component :is="状態バッジ" :state="results[item.id]?.状態 || '未実施'"/></div></div></template></aside>
<article aria-live="polite"><template v-if="row"><span class="eyebrow">モデル一覧 / {{row.名前}}</span><h2>{{row.名前}}</h2><component :is="状態バッジ" class="status" :state="result?.状態 || '未実施'"/><dl><dt>キー名</dt><dd>{{row.キー名}}</dd><dt>設定状況</dt><dd>{{config(row)}}</dd><dt>確認内容</dt><dd>{{確認内容}}</dd><dt>テスト</dt><dd>{{result?.説明 || row.理由 || '未実施。左側のテストボタンでモデル一覧を取得します。'}}</dd><dt>確認日時</dt><dd>{{result?.確認日時?new Date(result.確認日時).toLocaleString():'—'}}</dd></dl><h3>モデル一覧</h3><p v-if="result?.一覧範囲">{{result.一覧範囲}}</p><p v-if="result?.補完">{{result.補完}}</p><ul v-if="result?.モデル?.length" class="models"><li v-for="model in result.モデル" :key="model"><strong>{{model}}</strong><template v-for="detail in (result.モデル詳細 || []).filter(item=>item.model_id===model)" :key="detail.model_id"><br><span class="model-meta">作成日: {{detail.作成日 || '不明'}} · トークン数: {{detail.トークン数 || '不明'}} · モダリティ: {{detail.モダリティ || '不明'}}</span></template></li></ul><p v-else>{{result?.状態==='OK'?'取得結果にモデルがありません。':'まだモデルを取得していません。'}}</p><p v-for="warning in result?.警告 || []" :key="warning" class="warning">{{warning}}</p></template><div v-else class="welcome"><span class="eyebrow">KEY CONFIGURATION</span><h2>キーとモデル</h2><p>キーを選択すると、設定状況とモデル一覧を表示します。</p></div></article></main><details class="test-notes"><summary>テストについて</summary><p>キーの値は表示しません。起動時にキーなしで公開 OpenRouter 一覧を取得します。個別の「テスト」は各サービスへモデル一覧を問い合わせます。文章生成は行わず、「全テスト」の対象にも含みません。</p><p>公開モデル取得済・設定済はキーの有効性を示しません。OpenRouter のテストは公開一覧の表示のみです。OK は一覧 API の応答確認で、生成の可否・権限・料金を保証しません。</p></details></section>
</template>
