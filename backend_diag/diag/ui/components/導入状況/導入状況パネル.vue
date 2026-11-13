<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup>
import { ref, computed, unref, watch, nextTick } from 'vue';
import 前回実行日時 from '../共通表示/前回実行日時.vue';
import 状態バッジ from '../共通表示/状態バッジ.vue';
import { 先頭へスクロール, 完了時 } from '../共通表示/先頭表示.mjs';
import { 導入状況表示を作成 } from './導入状況表示.mjs';
import './導入状況.css';
import 公式サイト from './公式サイト.json';

const props = defineProps(['lastRun','項目', '結果', '確認中', '個別確認中', '個別確認Ids', '接続済み', '確認済み', '書込中', '書込済み', '表示中', '操作', '操作中', '全診断中']);
defineEmits(['確認', '個別確認', '書込']);
const { 選択ID, 折り畳み, 分類, 状態, 選択項目, 選択結果, 詳細項目, 参照箇所, 開閉 } = 導入状況表示を作成(props);
const パネル = ref(null), 詳細表示 = ref(true), コンソール = ref(null);
// 導入操作は項目ごとに並行する。選択中の項目（関連項目を含む）の最新の実行を表示する。
const 実行一覧 = computed(() => unref(props.操作?.実行一覧) || (unref(props.操作?.実行) ? [unref(props.操作.実行)] : []));
const 選択実行 = computed(() => 選択ID.value ? [...実行一覧.value].reverse().find(run => run.対象 === 選択ID.value || run.関連項目?.includes(選択ID.value)) || null : null);
const 実行中一覧 = computed(() => 実行一覧.value.filter(run => run.実行中 || ['実行中', '確認中'].includes(run.状態)));
const 操作後結果 = computed(() => 選択実行.value?.結果一覧 || (選択実行.value?.結果 ? [選択実行.value.結果] : []));
const 操作受付 = computed(() => unref(props.操作?.受付一覧)?.[選択ID.value] || null);
const 行確認中 = id => props.個別確認Ids ? props.個別確認Ids.has(id) : props.個別確認中===id;
const 行確認禁止 = id => !props.接続済み || props.確認中 || props.書込中 || props.操作中 || props.全診断中 || 行確認中(id);
const 操作禁止 = computed(() => !props.接続済み || props.確認中 || Boolean(props.個別確認中) || props.書込中 || props.操作中);
const 可能操作 = id => props.操作?.可能操作(id) || [];
// CLI 群は導入済みでも更新の入口を残す。実行可否はサーバーの能力だけで判断する。
const 導入更新対象 = id => props.項目.some(item => item.id === id && item.menuGroup === 'CLI群');
const 表示操作 = id => {
  const actions = 可能操作(id);
  return 導入更新対象(id) ? [actions.includes('再導入') ? '再導入' : '導入', ...actions.filter(action => action === '削除')] : actions;
};
const 操作表示名 = (id, action) => 導入更新対象(id) && action !== '削除' ? '導入・更新' : action;
const 操作不可理由 = id => 能力(id)?.理由 || (!props.接続済み ? '接続後に導入元を確認します。' : '導入元を確認しています。');
const 導入更新不可 = id => 導入更新対象(id) && !可能操作(id).some(action => ['導入', '再導入'].includes(action));
// 他の項目の導入操作中でも押せる。押せないのは診断・書込中と、この項目自身の実行中・受付中だけ。
const 項目操作禁止 = id => { unref(props.操作?.実行一覧); unref(props.操作?.受付一覧); return !props.接続済み || props.確認中 || Boolean(props.個別確認中) || props.書込中 || props.全診断中 || Boolean(props.操作?.項目操作中?.(id)); };
const 取消状態 = run => { unref(props.操作?.取消中); unref(props.操作?.実行一覧); return run ? props.操作?.取消状態?.(run.実行ID) || null : null; };
const 能力 = id => props.操作?.能力(id);
function 実行開始(item, action) { if (!可能操作(item.id).includes(action) || 項目操作禁止(item.id)) return; 選択ID.value = item.id; 詳細表示.value = false; void props.操作?.開始(item.id, action, item.name); }
// 更新は選択や表示モードを変更しない。タブ移動・別項目・詳細へ戻る操作を優先する。
watch(() => 選択実行.value?.ログ, async () => { await nextTick(); const node = コンソール.value; if (node && !詳細表示.value) node.scrollTop = node.scrollHeight; });
// 演出中は左の一覧を結果が出た項目へ追従スクロールし、右の詳細は先頭から表示する。
watch(()=>props.表示中,async id=>{if(!id)return;詳細表示.value=true;await nextTick();document.querySelector('#list .item.selected')?.scrollIntoView({block:'center'});const detail=document.querySelector('#detail');if(detail)detail.scrollTop=0;});
// 状況確認が終わったら、一覧・詳細を先頭（1項目目の表示）へスクロールする。
watch(()=>props.確認中,完了時(()=>先頭へスクロール(パネル.value)));
</script>
<template>
<section ref="パネル" class="panel install-panel" aria-label="導入状況">
  <div class="panel-heading"><h2>導入状況</h2><div class="panel-actions"><component :is="前回実行日時" :value="lastRun"/><button id="install-run" :class="{'check-next': !確認済み}" :disabled="操作禁止" @click="$emit('確認')">{{確認中?'確認中…':'状況確認'}}</button><button id="install-write" :class="{'write-next': 確認済み && !書込済み}" :disabled="操作禁止 || !確認済み" title="直前の確認結果を _AIDIY/aidiy_diag/install_info.json に保存します" @click="$emit('書込')">{{書込中?'書込中…':書込済み?'書込済':'書込'}}</button></div></div>
  <p v-if="操作 && unref(操作.エラー)" class="panel-note warning" role="status">{{unref(操作.エラー)}}</p>
  <p v-for="run in 実行中一覧" :key="run.実行ID" class="panel-note install-progress" role="status">{{項目.find(item=>item.id===run.対象)?.name || run.対象}} · {{run.操作}} · {{run.状態}}<button type="button" @click="選択ID=run.対象;詳細表示=false">実行コンソールを表示</button></p>
  <main>
    <aside aria-label="診断項目"><nav id="list"><details open><summary>導入状況</summary><template v-for="group in 分類" :key="group"><details :open="!折り畳み.has(group)" @toggle="開閉(group,$event)"><summary>{{group}} · {{項目.filter(e=>(e.menuGroup || 'その他拡張')===group).length}}</summary>
      <div v-for="item in 項目.filter(e=>(e.menuGroup || 'その他拡張')===group)" :key="item.id" class="install-item" :class="{selected:選択ID===item.id}">
        <div class="install-name"><button class="item" :class="{selected:選択ID===item.id}" :aria-pressed="選択ID===item.id" @click="選択ID=item.id;詳細表示=true"><span>{{item.name}}</span></button><a v-if="公式サイト[item.id]" class="install-web" :href="公式サイト[item.id]" target="_blank" rel="noopener noreferrer" :aria-label="`${item.name} の公式サイトを開く`" :title="`${item.name} の公式サイト`">Web</a></div>
        <div class="install-check"><button class="single-test-button" :data-install-check="item.id" :aria-label="`${item.name} の導入状況を確認`" :disabled="行確認禁止(item.id)" title="この項目の導入状況だけを再確認します" @click="選択ID=item.id;$emit('個別確認',item.id)">{{行確認中(item.id)?'確認中…':'確認'}}</button><component :is="状態バッジ" :state="状態(item.id)"/></div>
        <div v-if="表示操作(item.id).length" class="install-manage"><button v-for="action in 表示操作(item.id)" :key="action" type="button" :data-install-action="action" :data-install-id="item.id" :aria-label="`${item.name} を${操作表示名(item.id,action)}`" :aria-describedby="導入更新不可(item.id) ? `install-reason-${item.id}` : undefined" :class="{'install-delete':action==='削除'}" :disabled="項目操作禁止(item.id) || !可能操作(item.id).includes(action)" :title="可能操作(item.id).includes(action) ? 能力(item.id)?.説明 : 操作不可理由(item.id)" @click="実行開始(item,action)">{{操作表示名(item.id,action)}}</button><span v-if="導入更新不可(item.id)" :id="`install-reason-${item.id}`" class="install-unavailable">{{操作不可理由(item.id)}}</span></div>
      </div>
    </details></template></details></nav></aside>
    <article id="detail" aria-live="polite">
      <template v-if="選択項目">
        <span class="eyebrow">導入状況 / {{選択項目.menuGroup || 'その他拡張'}}</span><h2>{{選択項目.name}}</h2>
        <div v-if="詳細表示 && 選択結果?.状態==='注意' && ['python','node'].includes(選択項目.id)" class="security-version-warning" role="status"><strong>⚠ バージョンの注意</strong><p>{{選択結果.説明}}</p></div>
        <div class="install-detail-tabs" v-if="選択実行 || !詳細表示"><button type="button" :aria-pressed="詳細表示" @click="詳細表示=true">詳細</button><button type="button" :aria-pressed="!詳細表示" @click="詳細表示=false">コンソール</button></div>
        <template v-if="!詳細表示">
          <div class="install-console-heading"><span>{{操作受付?.操作 || 選択実行?.操作 || '導入操作'}}</span><component v-if="選択実行 && !操作受付" :is="状態バッジ" :state="選択実行.状態"/><span v-if="操作受付">開始受付中…</span><button v-if="選択実行?.実行中" id="install-cancel" type="button" :disabled="!接続済み || Boolean(取消状態(選択実行))" @click="操作.中止(選択実行.実行ID)">{{取消状態(選択実行)==='要求済み'?'中止確認中…':'中止'}}</button></div>
          <pre ref="コンソール" class="install-console" aria-label="導入操作コンソール" tabindex="0">{{操作受付 ? '実行を受け付けています。\n' : 選択実行?.ログ || '実行ログはここに表示されます。'}}</pre>
          <div v-if="操作後結果.length && !操作受付" class="install-recheck"><strong>操作後の確認</strong><div v-for="result in 操作後結果" :key="result.id" :data-install-result="result.id"><strong v-if="操作後結果.length > 1">{{項目.find(item=>item.id===result.id)?.name || result.id}} </strong><component :is="状態バッジ" :state="result.状態"/><p>{{result.説明}}</p><p v-if="result.バージョン">バージョン: {{result.バージョン}}</p><p v-if="result.パス">検出パス: {{result.パス}}</p></div></div>
          <p v-if="選択実行?.説明 && !操作受付">{{選択実行.説明}}</p><p v-if="選択実行?.状態==='停止未確認'" class="warning">プロセスの停止を確認できません。ログを確認し、終了を確認するまでこの項目の導入操作を行わないでください。</p>
        </template>
        <template v-else><component :is="状態バッジ" class="status" :state="状態(選択項目.id)"/><p>{{選択項目.description}}</p><p v-if="能力(選択項目.id)?.理由" class="install-capability-note">{{能力(選択項目.id).理由}}</p><dl><template v-for="[label,value] in 詳細項目" :key="label"><dt>{{label}}</dt><dd>{{value}}</dd></template></dl><h3>ソースの参照箇所</h3><ul><li v-for="source in 参照箇所" :key="source">{{source}}</li></ul></template>
      </template>
      <div v-else class="welcome"><span class="eyebrow">ENVIRONMENT DIAGNOSTICS</span><h2>導入状況</h2><p>ベース・CLI群・その他拡張からプログラムを選ぶと、利用用途と検出結果を表示します。</p><p>名前の直後の角丸の「Web」で公式サイトを開きます。右側に「確認」と状態を表示します。各項目の「確認」でその項目だけ、右上の「状況確認」で全項目のパスとバージョンを確認します。コマンドで安全に管理できる項目だけ、2行目の左側に「導入」または「再導入」「削除」を表示します。CLI群の「導入・更新」は導入済みでも使えます。安全な操作を確認できない場合は無効にして理由を表示します。</p><p>導入操作は確認ダイアログへの同意後に実行し、別の項目とは並行して実行できます（実行中の項目のボタンだけ押せなくなります）。終了後は「確認」ボタンと同じ処理を実行し、右側コンソールにログと確認結果を表示します。ログインや AI への問い合わせは行いません。</p></div>
    </article>
  </main>
</section>
</template>
