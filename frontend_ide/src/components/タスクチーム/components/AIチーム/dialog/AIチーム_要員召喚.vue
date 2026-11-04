<!-- COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
Licensed under "AiDiy 公開利用ライセンス v1.1".
Commercial use requires prior written consent from all copyright holders.
See LICENSE for full terms. Thank you for keeping the rules.
https://github.com/monjyu1101/AiDiy2027 -->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import 再読込ボタン from '@taskteam/components/再読込ボタン.vue';
import type { チーム要員 } from '../AIチーム_型';

const props = defineProps<{
  isOpen: boolean;
  召喚可能要員一覧: チーム要員[];
  召喚対象ID: string;
  召喚中: boolean;
  要員読込中: boolean;
  要員読込エラー: string;
  召喚実行: () => Promise<boolean>;
  要員再読込: () => Promise<void>;
}>();

const emit = defineEmits<{
  close: [];
  'update:summonTarget': [id: string];
}>();

const 検索語 = ref('');

const 候補一覧 = computed(() => {
  const keyword = 検索語.value.trim().toLocaleLowerCase();
  if (!keyword) return props.召喚可能要員一覧;
  return props.召喚可能要員一覧.filter((member) =>
    `${member.要員ID} ${member.役割}`.toLocaleLowerCase().includes(keyword),
  );
});

const 召喚対象を補正 = () => {
  if (!props.召喚可能要員一覧.some((member) => member.要員ID === props.召喚対象ID)) {
    emit('update:summonTarget', props.召喚可能要員一覧[0]?.要員ID ?? '');
  }
};

watch(
  () => props.isOpen,
  (open) => {
    if (!open) return;
    検索語.value = '';
    召喚対象を補正();
  },
);

const 一覧を再読込 = async () => {
  await props.要員再読込();
  召喚対象を補正();
};

const 召喚する = async () => {
  if (await props.召喚実行()) emit('close');
};
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="summon-dialog-backdrop" @click.self="emit('close')">
      <section class="summon-dialog" role="dialog" aria-modal="true" aria-label="要員召喚">
        <header>
          <div>
            <span>PERSONA DIRECTORY</span>
            <h2>要員を召喚</h2>
          </div>
          <button type="button" aria-label="閉じる" @click="emit('close')">×</button>
        </header>

        <input v-model="検索語" type="search" placeholder="フォルダ名・役割で検索" />

        <div class="summon-candidates">
          <button
            v-for="member in 候補一覧"
            :key="member.要員ID"
            type="button"
            :class="{ selected: member.要員ID === 召喚対象ID }"
            @click="emit('update:summonTarget', member.要員ID)"
          >
            <strong>{{ member.要員ID }}</strong>
            <span>{{ member.役割 || '役割未設定' }}</span>
          </button>
          <p v-if="候補一覧.length === 0">召喚できる要員が見つかりません。</p>
        </div>

        <p v-if="要員読込エラー" class="dialog-error">{{ 要員読込エラー }}</p>

        <footer>
          <component :is="再読込ボタン"
            class="summon-reload-button"
            title="一覧を再読込"
            label="一覧を再読込"
            :disabled="要員読込中 || 召喚中"
            @click="一覧を再読込"
          />
          <button
            type="button"
            class="primary"
            :disabled="要員読込中 || 召喚中 || !召喚対象ID"
            @click="召喚する"
          >
            {{ 召喚中 ? '召喚中…' : 'この要員を召喚' }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.summon-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(2, 8, 14, 0.72);
  backdrop-filter: blur(8px);
}

.summon-dialog {
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  padding: 20px;
  border: 1px solid rgba(116, 164, 207, 0.3);
  border-radius: 16px;
  color: #e8f5fb;
  background: #0c1b29;
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.5);
}

.summon-dialog header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 14px;
}

.summon-dialog header span {
  color: #8d7dff;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.summon-dialog h2 {
  margin: 3px 0 0;
  font-size: 20px;
}

.summon-dialog header button {
  width: 30px;
  height: 30px;
  border: 1px solid rgba(126, 161, 185, 0.22);
  border-radius: 8px;
  color: #9bb3c0;
  background: rgba(18, 38, 54, 0.9);
  cursor: pointer;
}

.summon-dialog > input {
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(105, 137, 175, 0.42);
  border-radius: 9px;
  color: #dcebf2;
  background: #102131;
  outline: none;
}

.summon-candidates {
  min-height: 180px;
  display: grid;
  gap: 6px;
  margin: 12px 0;
  overflow-y: auto;
}

.summon-candidates button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 11px;
  border: 1px solid rgba(121, 161, 186, 0.12);
  border-radius: 8px;
  color: #d7e7ef;
  background: rgba(14, 31, 46, 0.72);
  text-align: left;
  cursor: pointer;
}

.summon-candidates button.selected {
  border-color: rgba(141, 125, 255, 0.68);
  background: rgba(103, 79, 193, 0.22);
}

.summon-candidates button strong {
  font-size: 11px;
}

.summon-candidates button span,
.summon-candidates p {
  color: #718b9b;
  font-size: 9px;
}

.dialog-error {
  margin: 0 0 10px;
  color: #ff9bab;
  font-size: 10px;
}

.summon-dialog footer {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid rgba(121, 161, 186, 0.12);
}

.summon-reload-button {
  --refresh-button-height: 36px;
  --refresh-button-label-size: 16px;
  --refresh-button-padding: 0 14px;
}

.summon-dialog footer button:not(.refresh-button) {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid rgba(105, 137, 175, 0.36);
  border-radius: 8px;
  color: #9eb6c5;
  background: rgba(16, 33, 49, 0.9);
  cursor: pointer;
}

.summon-dialog footer button.primary {
  border-color: rgba(135, 114, 255, 0.65);
  color: #fff;
  background: linear-gradient(135deg, #7557e8, #4f82df);
}

.summon-dialog button:disabled:not(.refresh-button) {
  opacity: 0.45;
  cursor: default;
}
</style>
