// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { createApp } from 'vue';
import TaskTeamPanel from './タスクチームパネル.vue';
import { configureClient } from './api/client';
import '../../style.css';
import '../共通表示/会話表示.css';
async function main() {
  const response = await fetch('/development/config');
  if (!response.ok) throw Error('起動設定を取得できません。');
  const config = await response.json();
  configureClient(config.kind, config.taskTeamBase, config.projectFixed === true);
  document.title = `AiDiy ${config.projectFixed ? 'IDE / ' : ''}${config.kind.toUpperCase()}`;
  createApp(TaskTeamPanel, { config }).mount('#app');
}
void main().catch(error => { document.getElementById('app').textContent = error.message; });
