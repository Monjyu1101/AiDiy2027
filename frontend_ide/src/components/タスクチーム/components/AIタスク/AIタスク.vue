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
// AIタスク画面: 要求 / フロー図 / 明細 の 3 パネル構成（API は backend_taskteam が担当）
// frontend_web の AIタスク.vue と同等。認証は 利用者ID prop で受け取る。
import { ref } from 'vue';
import { taskClient } from '@taskteam/api/client';
import { qMessage } from '@taskteam/utils/qAlert';
import AIタスク要求一覧 from './components/AIタスク_要求一覧.vue';
import AIタスクフロー図 from './components/AIタスク_フロー図.vue';
import AIタスク明細一覧 from './components/AIタスク_明細一覧.vue';

const props = defineProps({
  利用者ID: { type: String, default: '' },
  権限ID: { type: String, default: '' }
});

const 選択タスクID = ref('');
const 選択タイトル = ref('');
const 選択マーメイド記号 = ref('');
const 明細rows = ref<Record<string, any>[]>([]);

// 要求パネルでタスクを選択したら、フロー図と明細を差し替える
// ちらつき防止のため事前クリアせず、取得成功時に置き換える
async function タスク明細読込(タスクID: string) {
  if (!タスクID) {
    明細rows.value = [];
    return;
  }
  try {
    const res = await taskClient.post('/task/タスク明細/一覧', {
      タスクID
    });
    if (res.data.status === 'OK') {
      明細rows.value = res.data.data?.items ?? [];
    } else {
      void qMessage(res.data.message || 'タスク明細の取得に失敗しました。', 'error');
    }
  } catch (e) {
    void qMessage('タスク明細の取得でエラーが発生しました。backend_taskteam (8093) の起動を確認してください。', 'error');
  }
}

async function タスク選択(row: Record<string, any>) {
  const 新タスクID = String(row.タスクID ?? '');
  const タスク変更 = 新タスクID !== 選択タスクID.value;
  選択タスクID.value = 新タスクID;
  選択タイトル.value = String(row.タイトル ?? '');
  選択マーメイド記号.value = String(row.マーメイド記号 ?? '');
  // 同一タスクの再選択では明細を取得しない（明細一覧側の更新監視が reload を発行する）
  if (タスク変更) {
    明細rows.value = [];
    await タスク明細読込(新タスクID);
  }
}

async function タスク明細再読込() {
  await タスク明細読込(選択タスクID.value);
}
</script>

<template>
  <div class="ai-task-view">
    <div class="task-grid">
      <!-- パネル1: タスク要求 -->
      <div class="task-panel">
        <component
          :is="AIタスク要求一覧"
          :利用者ID="props.利用者ID"
          :権限ID="props.権限ID"
          :選択タスクID="選択タスクID"
          @select="タスク選択"
        />
      </div>

      <!-- パネル2: フロー図 -->
      <div class="task-panel">
        <component
          :is="AIタスクフロー図"
          :タスクID="選択タスクID"
          :タイトル="選択タイトル"
          :マーメイド記号="選択マーメイド記号"
          :明細="明細rows"
        />
      </div>

      <!-- パネル3: タスク明細 -->
      <div class="task-panel">
        <component
          :is="AIタスク明細一覧"
          :タスクID="選択タスクID"
          :明細="明細rows"
          @reload="タスク明細再読込"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-task-view {
  width: 100%;
  height: 100%;
  position: relative;
  background: #1a1a1a;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 3分割グリッド（横並び） */
.task-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
  width: 100%;
  height: 100%;
  min-height: 100%;
  box-sizing: border-box;
}

.task-panel {
  background: #12101a;
  border: 1px solid rgba(118, 97, 204, 0.5);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.task-panel:hover {
  border-color: rgba(150, 120, 240, 0.9);
  box-shadow: 0 0 20px rgba(118, 97, 204, 0.45);
}

/* 縦長画面では3段（上下）に並べる */
@media (max-aspect-ratio: 1/1) {
  .task-grid {
    grid-template-columns: 1fr;
    grid-template-rows: repeat(3, minmax(0, 1fr));
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
