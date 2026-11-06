// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const { Receiver, Sender } = createRequire(import.meta.url)('ws');
const LIMIT = 20 * 1024 * 1024;

for (const [name, path, pattern] of [
  ['Discordパネル', '../src/web-server.ts', /new WebSocketServer\((\{[^}]+\})\)/],
  ['Discord Live', '../src/ライブ/Coreソケット.ts', /new Socket\(url, (\{[^}]+\})\)/],
] as const) test(`${name}: WS 20MiB境界をsocketなしで検証する`, async () => {
  const options = readFileSync(new URL(path, import.meta.url), 'utf8').match(pattern)?.[1];
  assert.ok(options);
  if (name === 'Discord Live') assert.match(readFileSync(new URL('../src/ライブ/ライブ会話.ts', import.meta.url), 'utf8'), /Coreソケット\(url, config\.coreRoot\)/);
  const { maxPayload } = runInNewContext(`(${options})`, { Core認証: () => ({}), url: 'ws://127.0.0.1', root: undefined });
  for (const extra of [0, 1]) {
    const receiver = new Receiver({ maxPayload, isServer: false });
    let received = 0, error: (Error & { code?: string }) | undefined;
    receiver.on('message', (data: Buffer) => { received = data.length; });
    receiver.on('error', (caught: Error) => { error = caught; });
    const frame = Buffer.concat(Sender.frame(Buffer.alloc(LIMIT + extra), { fin: true, opcode: 2, mask: false, rsv1: false, readOnly: true }));
    await new Promise<void>(resolve => receiver.write(frame, (caught?: Error) => { if (caught) error ||= caught; setImmediate(resolve); }));
    if (extra) { assert.equal(error?.code, 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'); assert.equal(received, 0); }
    else { assert.equal(error, undefined); assert.equal(received, LIMIT); }
    receiver.destroy();
  }
});
