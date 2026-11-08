// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { Receiver, Sender } from 'ws';
import { createExplorerFiles } from '../ファイル機能/explorer-files.mjs';
import { createAISearch } from '../ファイル機能/ai-search.mjs';
import { createFileAnalysis } from '../ファイル機能/file-analysis.mjs';
import { createTaskTeamProxy } from '../タスクチーム/api-proxy.mjs';

const LIMIT = 20 * 1024 * 1024;
const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
function payload(bytes, fields = {}) {
  const prefix = JSON.stringify({ ...fields, padding: '' }).slice(0, -2), suffix = '"}';
  const size = bytes - Buffer.byteLength(prefix + suffix);
  return Buffer.from(prefix + '日'.repeat(Math.floor(size / 3)) + 'x'.repeat(size % 3) + suffix);
}
function request(body, headers = {}) {
  // UTF-8の途中を含む任意のHTTP chunk境界でも、文字数でなく受信bytesを数える。
  const req = Readable.from([body.subarray(0, 23), body.subarray(23, body.length - 1), body.subarray(body.length - 1)]);
  Object.assign(req, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } });
  return req;
}
function response() {
  return Object.assign(new EventEmitter(), {
    status: 0, body: '', writeHead(status) { this.status = status; return this; },
    end(body = '') { this.body = body; this.writableEnded = true; return this; },
  });
}

test('Explorer HTTP: 20MiBを読み込み、実測/宣言の超過は413、操作検証は維持する', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'aidiy-transport-'));
  const files = createExplorerFiles(folder, { native: {} });
  try {
    for (const extra of [0, 1]) {
      const body = payload(LIMIT + extra, { action: 'invalid' }), res = response();
      await files.handle(request(body, { 'x-aidiy-explorer': '1' }), res, new URL('http://fixture/api/explorer/actions'));
      assert.equal(res.status, extra ? 413 : 400);
      assert.equal(JSON.parse(res.body).error, extra ? 'body_too_large' : 'invalid_action');
    }
    const res = response();
    await files.handle(request(Buffer.from('{}'), { 'x-aidiy-explorer': '1', 'content-length': String(LIMIT + 1) }), res, new URL('http://fixture/api/explorer/actions'));
    assert.equal(res.status, 413);
  } finally { files.close(); await rm(folder, { recursive: true, force: true }); }
});

for (const [name, create, path, fields, semantic, oversized] of [
  ['検索', createAISearch, 'ai-search', { query: '' }, /1〜2000文字/, /検索内容が長すぎ/],
  ['解析', createFileAnalysis, 'file-analysis', { path: '../outside', instruction: '調査' }, /ファイルパスが不正/, /解析指示が長すぎ/],
]) test(`${name} HTTP: 20MiBまで業務検証へ進み、20MiB+1は受信時に拒否する`, async () => {
  const service = create(tmpdir(), { state: () => ({ active: true }), runAgent: () => assert.fail('実エージェントを呼ばない') });
  try {
    for (const extra of [0, 1]) {
      const res = response();
      await service.handle(request(payload(LIMIT + extra, fields)), res, new URL(`http://fixture/api/${path}`));
      assert.equal(res.status, 400); assert.match(JSON.parse(res.body).error, extra ? oversized : semantic);
    }
  } finally { service.close(); }
});

test('TaskTeam HTTP proxy: 20MiBは完全転送し、20MiB+1は上流を呼ばない', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'aidiy-proxy-transport-')), calls = [];
  const proxy = createTaskTeamProxy(folder, folder, { fetcher: async (_url, options) => {
    calls.push(options.body); return { status: 200, text: async () => '{"ok":true}' };
  } });
  try {
    for (const extra of [0, 1]) {
      const body = payload(LIMIT + extra), res = response();
      await proxy.handle(request(body), res, new URL('http://fixture/taskteam-api/team/test'));
      assert.equal(res.status, extra ? 413 : 200);
      assert.equal(calls.length, 1);
      if (!extra) assert.ok(calls[0].equals(body), 'マルチバイト本文を変更せず転送');
    }
  } finally { proxy.close(); await rm(folder, { recursive: true, force: true }); }
});

// 起動関数はsocketを開くため、実装中のbody読み取りブロックをそのままVMへ渡す。
// 閾値・比較式・decode処理をfixture側で複製しない。
for (const [name, path, start, end, returned] of [
  ['Code', '../host/aidiy_code/src/server.ts', "req.setEncoding('utf8');", '// IDE埋め込み時', 'data'],
  ['Live', '../host/aidiy_live/src/server.ts', 'const chunks: Buffer[] = [];', 'if (saveModel)', "JSON.parse(body.toString('utf8'))"],
  ['共有下書き', '../デスクトップ/下書き共有.cjs', 'const chunks=[];', 'if(req.url===`/${token}/viewer-status`)', 'data'],
]) test(`${name} HTTP body reader: UTF-8 bytesで20MiB境界とchunk分割を扱う`, async () => {
  const text = source(path), from = text.indexOf(start), to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, '実装ブロックが見つかる');
  const reader = vm.runInNewContext(`(async (req,res,reply) => {${text.slice(from, to).replace('const chunks: Buffer[]', 'const chunks')} return ${returned};})`, { Buffer });
  for (const extra of [0, 1]) {
    const body = payload(LIMIT + extra, { projectPath: '/project' }), res = response();
    let result, error;
    try { result = await reader(request(body), res, status => { res.status = status; }); } catch (caught) { error = caught; }
    if (extra) { assert.ok(res.status === 413 || /要求が大きすぎ/.test(error?.message)); assert.equal(result, undefined); }
    else { assert.equal(error, undefined); assert.equal(JSON.stringify(result), body.toString('utf8')); }
  }
});

for (const [name, path] of [
  ['Console', '../aidiy_console/console.mjs'], ['Browser CDP', '../デスクトップ/ブラウザCDP.cjs'],
]) test(`${name} WS: 20MiBを許可し、20MiB+1は1009で拒否（socket不使用）`, async () => {
  const options = source(path).match(/new WebSocketServer\((\{[^}]+\})\)/)?.[1];
  assert.ok(options);
  const { maxPayload } = vm.runInNewContext(`(${options})`);
  for (const extra of [0, 1]) {
    const receiver = new Receiver({ maxPayload, isServer: false });
    let received = 0, error;
    receiver.on('message', data => { received = data.length; });
    receiver.on('error', caught => { error = caught; });
    const frame = Buffer.concat(Sender.frame(Buffer.alloc(LIMIT + extra), { fin: true, opcode: 2, mask: false, rsv1: false, readOnly: true }));
    await new Promise(resolve => receiver.write(frame, caught => { if (caught) error ||= caught; setImmediate(resolve); }));
    if (extra) { assert.equal(error?.code, 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH'); assert.equal(received, 0); }
    else { assert.equal(error, undefined); assert.equal(received, LIMIT); }
    receiver.destroy();
  }
});

test('Code本文の業務上限20万文字はHTTP転送上限と独立して維持する', () => {
  const guard = source('../host/aidiy_code/src/server.ts').match(/if \(typeof data\.メッセージ内容[^\n]+/u)?.[0];
  assert.ok(guard);
  const validate = vm.runInNewContext(`(data, reply) => { ${guard} return true; }`);
  let status;
  assert.equal(validate({ メッセージ内容: '日'.repeat(200000) }, value => { status = value; }), true);
  assert.equal(status, undefined);
  assert.equal(validate({ メッセージ内容: '日'.repeat(200001) }, value => { status = value; }), undefined);
  assert.equal(status, 400);
});
