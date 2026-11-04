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

import { ローカルTools接続先 } from '../aidiy_live/local-backend.cjs';

type PredictionContext = { projectPath: string; conversationId: string; sessionId: string; enabled: boolean };
type PredictionRequest = { requestId?: unknown; projectPath?: unknown; conversationId?: unknown; sessionId?: unknown };
const identity = (value: PredictionContext) => JSON.stringify([value.projectPath, value.conversationId, value.sessionId]);

/** 画面の任意URL・プロジェクト指定を通さず、現在のCode会話だけを内部RESTへ渡す。 */
export class InputPrediction {
  private requests = new Map<string, { controller: AbortController; context: string }>();
  constructor(private root: string, private context: () => PredictionContext, private request: typeof fetch = fetch) {}
  cancel(requestId: unknown) {
    if (typeof requestId !== 'string') return;
    this.requests.get(requestId)?.controller.abort(); this.requests.delete(requestId);
  }
  clear() { for (const id of this.requests.keys()) this.cancel(id); }
  sync() {
    const current = this.context();
    for (const [id, request] of this.requests) if (!current.enabled || request.context !== identity(current)) this.cancel(id);
  }
  async predict(data: PredictionRequest): Promise<{ type: 'predictionResult'; requestId: unknown; text: string }> {
    const result = { type: 'predictionResult' as const, requestId: data.requestId, text: '' };
    const current = this.context();
    if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(data.requestId) || !current.enabled
        || !current.projectPath || !current.sessionId || data.projectPath !== current.projectPath
        || data.conversationId !== current.conversationId || data.sessionId !== current.sessionId
        || this.requests.has(data.requestId) || this.requests.size >= 4) return result;
    const controller = new AbortController(), context = identity(current);
    this.requests.set(data.requestId, { controller, context });
    const timer = setTimeout(() => controller.abort(), 123000);
    const valid = () => !controller.signal.aborted && this.context().enabled && identity(this.context()) === context;
    try {
      const target = ローカルTools接続先(this.root, current.projectPath);
      // Core接続だけをtools通信可能とみなさない。Console/IDEと同じpingで確認する。
      const ping = await this.request(new URL('/aidiy_code_agents/ping', target), {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1500)]), redirect: 'error',
      });
      if (!ping.ok) return result;
      const health = await ping.json() as { status?: string; name?: string };
      if (!valid() || health.status !== 'ok' || health.name !== 'aidiy_code_agents') return result;
      const response = await this.request(new URL('/internal/prediction_llms', target), {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-AiDiy-Diag': 'model-trial' },
        body: JSON.stringify({ project_path: current.projectPath, timeout_sec: 120 }), signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) return result;
      const value = await response.json() as { status?: string; result?: string };
      if (valid() && value.status === 'OK' && typeof value.result === 'string' && value.result.trim() && value.result.length <= 200000)
        result.text = value.result.trim();
    } catch { /* 予測失敗は会話・ログへ追加せず、入力補助だけを静かに終了する。 */ }
    finally {
      clearTimeout(timer);
      if (this.requests.get(data.requestId)?.controller === controller) this.requests.delete(data.requestId);
    }
    return result;
  }
}
