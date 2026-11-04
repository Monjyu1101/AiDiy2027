<!--
  -*- coding: utf-8 -*-

  -------------------------------------------------------------------------
  COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
  Licensed under "AiDiy 公開利用ライセンス v1.1".
  Commercial use requires prior written consent from all copyright holders.
  See LICENSE for full terms. Thank you for keeping the rules.
  https://github.com/monjyu1101/AiDiy2027
  -------------------------------------------------------------------------
-->

<script setup lang="ts">
import { taskChannelName } from '../../../task-session';
// AIタスク_明細ウィンドウ (Electron task3): 要求ウィンドウの選択タスクを
// BroadcastChannel(aidiy-task-sync) で受け取り、タスク明細一覧を表示する
// （明細一覧コンポーネント自身の 5 秒ポーリングが reload を要求してくる）
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { taskClient } from '@taskteam/api/client';
import AIタスク明細一覧 from '../components/AIタスク_明細一覧.vue';

const 選択タスクID = ref('');
const 明細rows = ref<Record<string, any>[]>([]);
let channel: BroadcastChannel | null = null;
let revision = 0, disposed = false;

async function 明細読込() {
  const run = ++revision, id = 選択タスクID.value;
  if (!選択タスクID.value) {
    明細rows.value = [];
    return;
  }
  try {
    const res = await taskClient.post('/task/タスク明細/一覧', {
      タスクID: id
    });
    if (disposed || run !== revision || id !== 選択タスクID.value) return;
    明細rows.value = res.data.status === 'OK' ? (res.data.data?.items ?? []) : [];
  } catch {
    if (disposed || run !== revision) return;
    明細rows.value = [];
  }
}

onMounted(() => {
  channel = new BroadcastChannel(taskChannelName('sync'));
  channel.addEventListener('message', (event: MessageEvent) => {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;
    if (payload.type === 'task-selected') {
      選択タスクID.value = String(payload.タスクID ?? '');
      void 明細読込();
    }
  });
  // 要求ウィンドウへ現在の選択を要求する
  channel.postMessage({ type: 'request-task-selection' });
});

onBeforeUnmount(() => {
  disposed = true; revision++;
  channel?.close();
  channel = null;
});
</script>

<template>
  <div class="task-window-body">
    <component
      :is="AIタスク明細一覧"
      :タスクID="選択タスクID"
      :明細="明細rows"
      :showHeader="true"
      @reload="明細読込"
    />
  </div>
</template>

<style scoped>
.task-window-body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #12101a;
}
</style>
