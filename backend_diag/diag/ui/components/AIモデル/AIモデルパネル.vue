<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import {computed,ref,watch,onBeforeUnmount} from 'vue';
import {再生可能な音声} from '../設定モデル/設定モデル音声.mjs';
import 状態バッジ from '../共通表示/状態バッジ.vue';
import './AIモデル.css';
const props=defineProps(['state','online','visible']);
const s=props.state;
const audio=computed(()=>再生可能な音声(s.結果.value));
const audioState=computed(()=>s.音声状態.value[audio.value?.id]);
const player=ref(null);
function stop(){const p=player.value;if(p){p.pause();p.removeAttribute('src');p.load();}}
watch(()=>[props.visible,audio.value?.id,audioState.value?.url],stop,{flush:'sync'});
onBeforeUnmount(stop);
const change=(key,event)=>s.変更(key,event.target.value);
// 実行中は取得中の経過、完了後は結果に残した経過を表示する。
const 経過=computed(()=>s.区分.value!=='PREDICTION'?[]:s.実行中.value?s.経過.value:s.結果.value?.経過||[]);
</script>
<template>
<section class="panel ai-model-panel" aria-label="AIモデル">
 <div class="panel-heading ai-model-heading"><div class="heading-title"><h2>AIモデルを試す</h2><button class="ai-model-reload refresh-button" title="AIモデルの候補を再読込します" :aria-busy="s.読込中.value" :disabled="!online || s.読込中.value || s.実行中.value" @click="s.読込"><span class="refresh-glyph" aria-hidden="true">↺</span><span>候補を再読込</span></button></div><div class="panel-actions"><button id="ai-model-start" :class="{'check-next': !s.結果.value}" :disabled="!online || s.実行中.value || s.読込中.value || !s.一覧.value" title="CHAT → LIVE → PREDICTION → DECISION → CODE を順に確認します" @click="s.開始(true)">{{s.実行中.value?'実行中…':'動作確認'}}</button><button :disabled="!s.実行中.value" @click="s.中止('試行を中止しました。')">中止</button></div></div>
 <p class="panel-note">各タブのモデルと入力を選び、「動作確認」でCHAT → LIVE → PREDICTION → DECISION → CODEを順に試します。完了後はCHATへ戻ります。選択は設定へ保存されません。</p>
 <nav class="tabs ai-model-tabs" aria-label="AIモデルの種類"><button v-for="family in ['CHAT','LIVE','PREDICTION','DECISION','CODE']" :key="family" :class="{active:s.区分.value===family}" :aria-pressed="s.区分.value===family" @click="s.区分変更(family)">{{family}}</button></nav>
 <div class="ai-model-scroll">
  <div class="ai-model-form">
   <div class="ai-model-form-heading"><h3>{{s.区分.value}} / {{s.区分.value==='PREDICTION'?'入力予測':'入力'}}</h3><button id="ai-model-test" class="single-test-button" :disabled="!online || s.実行中.value || s.読込中.value || !s.一覧.value || (s.区分.value==='PREDICTION' && !s.予測条件.value.テスト可能)" :title="s.区分.value==='PREDICTION'?s.予測条件.value.説明:'現在の種類だけをテストします'" @click="s.開始()">テスト</button></div>
   <p v-if="!online" class="warning" role="status">Tools 接続時に利用できます。</p>
   <p v-if="s.一覧.value?.区分?.[s.区分.value]?.状態==='未取得'" class="warning">モデル一覧が未取得です。設定保持値がある場合だけ表示します。</p>
   <label class="ai-config-row"><span>{{s.区分.value}}_AI:</span><select aria-label="プロバイダ" :value="s.入力.provider" :disabled="s.読込中.value" @change="change('provider',$event)"><option v-if="!s.プロバイダ.value.length" value="">候補なし</option><option v-for="p in s.プロバイダ.value" :key="p.id" :value="p.id">{{p.id}}</option></select></label>
   <p v-if="s.区分.value==='PREDICTION'" class="ai-help ai-provider-priority">プロバイダ選択優先順（auto）: codex_cli → copilot_cli → aidiy_hermes → openai_oauth → freeai_chat → openai_chat → gemini_chat<br>使えるプロバイダ（モデル候補があるもの）から自動選択します。auto選択時はPREDICTION_AI_NAMEの設定を優先し、設定もautoの場合にこの順で選びます。</p>
   <p v-if="s.区分.value==='DECISION'" class="ai-help ai-provider-priority">プロバイダ選択優先順（auto）: openai_oauth → freeai_chat → openai_decisions → gemini_chat<br>使えるプロバイダ（起動チェック成功）から自動選択します。auto選択時はDECISION_AI_NAMEの設定を優先し、設定もautoの場合にこの順で選びます。</p>
   <label class="ai-config-row"><span>{{s.区分.value}}_MODEL:</span><select aria-label="モデル" :value="s.入力.model" :disabled="s.読込中.value" @change="change('model',$event)"><option v-if="!s.モデル.value.length" value="">候補なし</option><option v-for="m in s.モデル.value" :key="m.id" :value="m.id">{{m.名前}}</option></select></label>
   <label v-if="s.区分.value==='LIVE'" class="ai-config-row"><span>LIVE_VOICE:</span><select aria-label="音声" :value="s.入力.voice" @change="change('voice',$event)"><option v-if="!s.音声候補.value.length" value="">候補なし</option><option v-for="v in s.音声候補.value" :key="v.id" :value="v.id">{{v.名前}}</option></select></label>
   <label v-if="s.区分.value!=='PREDICTION'" class="ai-input-label">{{s.区分.value==='DECISION'?'判断対象の入力':'自由プロンプト'}}<textarea aria-label="自由プロンプト" :value="s.入力.prompt" maxlength="16000" rows="5" @input="change('prompt',$event)"></textarea></label>
   <fieldset v-if="s.区分.value==='DECISION'"><legend>質問</legend>
    <label class="ai-config-row"><span>形式</span><select aria-label="質問形式" :value="s.入力.type" @change="change('type',$event)"><option value="choice">選択（choice）</option><option value="predicate">判定（predicate）</option><option value="score">スコア（score）</option></select></label>
    <label class="ai-config-row"><span>質問名</span><input aria-label="質問名" :value="s.入力.name" maxlength="100" @input="change('name',$event)"></label>
    <label class="ai-input-label">質問文<textarea aria-label="質問文" :value="s.入力.instructions" maxlength="4000" rows="3" @input="change('instructions',$event)"></textarea></label>
    <label v-if="s.入力.type!=='predicate'" class="ai-input-label">{{s.入力.type==='choice'?'選択肢（1行に1件）':'スコアの段階（低い順に1行に1件）'}}<textarea aria-label="選択肢・段階" :value="s.入力.choices" rows="4" @input="change('choices',$event)"></textarea></label>
   </fieldset>
   <p v-if="s.区分.value==='LIVE'" class="ai-help">接続後15秒待機して送信し、応答を最大60秒待ちます。1秒以上の応答音声を一時保存し、ここで再生できます。</p>

   <template v-if="s.区分.value==='PREDICTION'"><p class="ai-help">Chatテスト成功後に試行でき、OKになったChatのモデルで「昔々、あるところに」「おじいさんと」の2ターンを送り、履歴保存を確認してから予測します。CODE_BASE_PATHの同一プロジェクトの直近2時間・最大10ターンが対象で、「おばあさん」が返れば完璧です。予測結果は履歴に保存しません。</p><p class="ai-help">対象: {{s.一覧.value?.予測条件?.プロジェクト || '未設定'}}<br>予測モデル: {{s.予測条件.value.プロバイダ || '未取得'}} / {{s.予測条件.value.モデル || '未取得'}}</p><p v-if="!s.予測条件.value.テスト可能" class="warning">{{s.予測条件.value.説明}}</p><p class="ai-help">正常な非空応答は!・！を含む説明もOKです。履歴なし・空応答・エラー・タイムアウトは成功扱いにしません。</p></template>
   <p class="ai-help">試行時に選択したAIへ送信します。料金が発生する場合があります。</p>
  </div>
  <section class="ai-model-output" aria-label="試行結果" aria-live="polite"><h3>出力</h3><component :is="状態バッジ" :state="s.実行中.value?'実行中':s.結果.value?.状態||'未実施'"/><p role="status">{{s.通知.value || '入力して「動作確認」を押してください。'}}</p>
   <ol v-if="経過.length" class="ai-model-steps" aria-label="予測の経過"><li v-for="(step,i) in 経過" :key="i"><component :is="状態バッジ" :state="step.状態"/><span class="ai-model-step-text">{{step.内容}}</span><span class="ai-model-step-time">{{step.秒}}秒</span></li></ol>
   <dl v-if="s.結果.value"><dt>指定プロバイダ</dt><dd>{{s.結果.value.指定プロバイダ || '—'}}</dd><dt>実行プロバイダ</dt><dd>{{s.結果.value.実行プロバイダ || '応答に情報なし'}}</dd><dt>指定モデル</dt><dd>{{s.結果.value.指定モデル || '—'}}</dd><dt>実行モデル</dt><dd>{{s.結果.value.実行モデル || '応答に情報なし'}}</dd></dl>
   <section v-if="s.区分.value==='LIVE' && s.結果.value" class="ai-model-audio" aria-label="Live 応答音声"><h3>応答音声</h3>
    <template v-if="audio"><p>{{(audio.長さms/1000).toFixed(2)}} 秒 · 一時保存</p><audio v-if="audioState?.url && visible" ref="player" :key="audio.id" :src="audioState.url" controls preload="metadata" aria-label="Live 応答音声の再生" @error="s.音声再生失敗(audio.id)"></audio><span v-if="!audioState?.url && !audioState?.エラー">音声を準備中…</span><button v-if="audioState?.エラー" class="refresh-button" :aria-busy="Boolean(audioState?.読込中)" :disabled="!online || audioState?.読込中" @click="s.音声読込(s.結果.value)"><span class="refresh-glyph" aria-hidden="true">↺</span><span>音声取得を再試行</span></button><p v-if="audioState?.エラー" class="warning">{{audioState.エラー}}</p></template>
    <p v-else class="warning">1秒以上の再生可能な音声がありません。</p>
   </section>
   <h3>{{s.区分.value==='DECISION'?'戻り値（JSON / テキスト）':'応答テキスト'}}</h3><pre class="ai-model-reply">{{s.結果.value?.応答 || '応答はまだありません。'}}</pre><p v-if="s.結果.value?.説明">{{s.結果.value.説明}}</p>

  </section>
 </div>
</section>
</template>
