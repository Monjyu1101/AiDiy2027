/*!
 * -*- coding: utf-8 -*-
 *
 * -------------------------------------------------------------------------
 * COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. Thank you for keeping the rules.
 * https://github.com/monjyu1101/AiDiy2027
 * -------------------------------------------------------------------------
 */

import { 設定解析, プロジェクトルート } from '../src/接続/接続設定';

export const teamId = 'T0TESTTEAM1';
export const userId = 'U0TESTUSER1';
export const channelId = 'C0TESTCHAN1';
export const botUserId = 'U0TESTBOT01';
export const defaults = {
  slack_bot_token: 'xoxb-test-token', slack_app_token: '< your slack app-level token >',
  slack_team_id: teamId, slack_allowed_user_id: userId, slack_text_channel_id: channelId,
};
export const config = () => 設定解析(defaults, プロジェクトルート);
export async function waitFor(condition: () => boolean, timeout = 3000) {
  const until = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= until) throw new Error('検証の待機時間を超えました。');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
