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

import { register } from 'tsx/esm/api';
import { WorkerBootstrapper } from '@discordjs/ws';
register();
const { Discord通信 } = await import('./接続/ネットワーク接続.ts');
const network = new Discord通信();
network.Gateway開始();
// Gateway用agentとソケットはこのworkerだけが所有する。SDKのstrategy.destroy
// がworkerを終了し、認証前・再接続待ちを含めてソケットとタイマーを回収する。
await new WorkerBootstrapper().bootstrap();
