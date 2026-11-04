<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1". See LICENSE. -->
<script setup>
import {ref,computed,watch,nextTick,onUnmounted} from 'vue';
import {Tools状態を作成} from './Tools状態.mjs';
import {Tools代表テスト} from './Tools代表テスト.mjs';
import 状態バッジ from '../共通表示/状態バッジ.vue';
import './Tools.css';
const props=defineProps({api:Function,connected:Boolean,coreOnline:Boolean,toolsOnline:Boolean,visible:Boolean});
const ready=()=>props.connected&&props.coreOnline&&props.toolsOnline;
const state=Tools状態を作成({api:(...args)=>props.api(...args),利用可能:ready,代表テスト:Tools代表テスト});
const userId=ref(''),password=ref(''),detailPane=ref(null);
const authenticated=computed(()=>state.認証済み.value&&ready());
const current=computed(()=>state.選択.value),fields=computed(()=>state.schema.value[current.value?.defaultsKey]||{});
const test=computed(()=>state.テスト定義(current.value?.id));
watch(()=>current.value?.id,id=>{const def=state.テスト定義(id);if(def&&!state.テスト条件.value[id])state.テスト条件.value[id]={...def.defaults};},{immediate:true});
watch(()=>current.value?.id,async()=>{await nextTick();if(detailPane.value)detailPane.value.scrollTop=0;});
async function login(){const secret=password.value;password.value='';await state.ログイン(userId.value,secret);}
watch(ready,value=>{if(!value){password.value='';state.切断();}},{flush:'sync'});
watch(()=>props.visible,value=>{if(!value)state.テスト中止();},{flush:'sync'});
onUnmounted(()=>{password.value='';state.終了();});
</script>
<template>
<section class="tools-panel panel" aria-label="Tools管理">
 <div class="panel-heading tools-heading">
  <div class="heading-title"><h2>Tools管理</h2><button v-if="authenticated" class="tools-reload refresh-button" :aria-busy="state.処理中.value==='read'" :disabled="!!state.処理中.value" @click="state.再読込()"><span class="refresh-glyph" aria-hidden="true">↺</span><span>再読込</span></button></div>
  <div class="panel-actions">
   <button v-if="authenticated" class="single-test-button tools-batch-test" :disabled="!!state.処理中.value||!state.一括対象数.value" :aria-busy="state.処理中.value==='test-all'" title="有効・利用可能なToolを順番に試験します。通知音・専用ブラウザの起動・実際のバックアップ作成も含みます。" @click="state.一括テスト()">一括テスト</button>
   <button v-if="state.処理中.value==='test-all'" @click="state.テスト中止()">一括テストを中止</button>
   <button v-if="state.認証済み.value" @click="state.ログアウト()">Coreからログアウト</button>
  </div>
 </div>
 <div class="tools-scroll" :class="{'tools-authenticated':authenticated}">
  <div v-if="!authenticated" class="tools-auth">
   <p class="tools-note">Coreの利用者IDでログインしてください。認証はこの画面内だけで保持します。</p>
   <p v-if="!connected" role="status">先にDiagへ接続してください。</p>
   <p v-else-if="!coreOnline||!toolsOnline" role="status">システム起動で Core と Tools を起動してください。</p>
   <form v-else class="tools-login" @submit.prevent="login">
    <label>利用者ID<input v-model="userId" autocomplete="username" :disabled="!!state.処理中.value" required></label>
    <label>パスワード<input v-model="password" type="password" autocomplete="off" :disabled="!!state.処理中.value" required></label>
    <button :disabled="!!state.処理中.value">{{state.処理中.value?'接続中…':'Coreへログイン'}}</button>
   </form>
   <p v-if="state.通知.value" class="tools-notice" role="status" aria-live="polite">{{state.通知.value}}</p>
  </div>
  <div v-else class="tools-columns">
   <section class="tools-list" aria-label="Tools一覧" tabindex="0">
    <div class="tools-section-heading"><h3>Tools一覧</h3><button :class="{'write-next':Object.keys(state.有効変更.value).length>0}" :disabled="!!state.処理中.value||!Object.keys(state.有効変更.value).length" @click="state.有効保存()">オン・オフを保存</button></div>
    <p class="tools-help">Tool名を選ぶと、右側（狭い画面では下側）に既定値・テスト内容を表示します。</p>
    <details class="tools-help"><summary>管理の注意事項</summary><p>OFFでも登録は維持し「サービス外」として応答します。既定値の変更は次の実行から反映されます。状態バッジはテスト結果です。未実施・実行中・OK・ERRなどを表示します。</p></details>
    <p v-if="Object.keys(state.有効変更.value).length" class="tools-unsaved">オン・オフ：未保存の適用があります</p>
    <ul><li v-for="row in state.項目.value" :key="row.id" :class="{selected:row.id===state.選択ID.value}">
     <button class="tools-name" :aria-pressed="row.id===state.選択ID.value" @click="state.選択ID.value=row.id">{{row.label||row.id}}<span v-if="!row.available||!row.enabled" class="tools-status">{{!row.available?'未導入':'無効'}}</span></button>
     <button class="tools-switch" :aria-pressed="row.enabled" :aria-label="`${row.label||row.id} ${row.enabled?'OFFにする':'ONにする'}`" :disabled="!!state.処理中.value||!row.available" @click="state.切替(row.id)">{{row.enabled?'ON':'OFF'}}</button>
     <button class="single-test-button tools-row-test" :disabled="!!state.処理中.value||!row.available||!row.enabled||!state.テスト定義(row.id)" :title="state.テスト定義(row.id)?.label||'代表機能テストは未対応です'" @click="state.テスト(row.id)">テスト</button>
     <component :is="状態バッジ" class="tools-result" :state="state.結果.value[row.id]?.status||'未実施'" :title="state.結果.value[row.id]?.message||'テストは未実施です。'"/>
    </li></ul>
   </section>
   <section ref="detailPane" class="tools-detail" aria-label="既定値とテスト内容" tabindex="0">
    <div class="tools-section-heading"><h3>テスト内容</h3><button class="single-test-button tools-detail-test" :disabled="!!state.処理中.value||!current?.available||!current?.enabled||!test" @click="state.テスト(current.id)">テスト</button></div>
    <p v-if="state.通知.value" class="tools-notice" role="status" aria-live="polite">{{state.通知.value}}</p>
    <template v-if="current">
     <h4 class="tools-selected-name">{{current.label||current.id}}</h4><p class="tools-id">{{current.id}}</p>
     <section class="tools-defaults" aria-label="既定値">
      <h4>既定値</h4>
      <form v-if="Object.keys(fields).length" @submit.prevent="state.規定値設定(true)">
       <label v-for="(choices,name) in fields" :key="name" class="tools-config-row"><span>{{name}}</span><select v-model="state.編集値.value[current.defaultsKey][name]" :disabled="!!state.処理中.value||!current.available"><option v-for="choice in choices" :key="choice" :value="choice">{{choice}}</option></select></label>
       <div class="tools-actions"><button type="button" :disabled="!!state.処理中.value||!current.available" @click="state.規定値設定(false)">適用のみ</button><button :disabled="!!state.処理中.value||!current.available">既定値を保存</button></div>
       <p v-if="state.未保存規定値.value[current.defaultsKey]" class="tools-unsaved">実行時へ適用済み・ファイル未保存</p>
      </form>
      <p v-else class="tools-help">このToolには変更できる既定値はありません。</p>
     </section>
     <fieldset class="tools-test-content"><legend>テスト条件</legend>
      <p v-if="!current.available" class="warning">この環境では利用できません。</p><p v-else-if="!current.enabled" class="warning">OFF（サービス外）のため実行しません。専用ブラウザを終了する場合は、先にこのToolをONへ戻してください。</p>
      <template v-if="test"><h4>{{test.label}}</h4><p class="tools-help">{{test.description}}</p><label v-if="test.headless" class="tools-test-option"><input v-model="state.テスト条件.value[current.id].headless" type="checkbox" :disabled="!!state.処理中.value||!current.available||!current.enabled">画面を表示しない（headless）</label><label v-if="test.batch" class="tools-test-option"><input v-model="state.テスト条件.value[current.id].batch" type="checkbox" :disabled="!!state.処理中.value||!current.available||!current.enabled">batch（コピーを別スレッドで実行・受付を返す）</label><p v-if="test.batch" class="warning">実際にバックアップを作成します。batch ONのOKは受付成功で、コピー完了ではありません。</p><div class="tools-actions"><button class="single-test-button" :disabled="!!state.処理中.value||!current.available||!current.enabled" @click="state.テスト(current.id)">この条件でテスト</button><button v-if="test.close" :disabled="!!state.処理中.value||!current.available||!current.enabled" @click="state.テスト(current.id,true)">専用ブラウザを終了</button></div></template>
      <p v-else class="tools-help">このToolの代表機能テストは未対応です。状態の表示は機能テスト成功を意味しません。</p>
     </fieldset>
    </template><p v-else class="tools-help">一覧からToolを選択してください。</p>
    <section class="tools-output" aria-label="テスト結果" aria-live="polite">
     <div class="tools-section-heading"><h3>テスト結果</h3><button v-if="state.処理中.value==='test'" @click="state.テスト中止()">待機を中止</button></div>
     <component :is="状態バッジ" :state="state.結果.value[current?.id]?.status||'未実施'"/>
     <pre class="tools-test-output">{{state.結果.value[current?.id]?.message||'テストの応答はまだありません。左のToolを選び、条件を確認して「テスト」を押してください。'}}</pre>
    </section>
   </section>
  </div>
 </div>
</section>
</template>
