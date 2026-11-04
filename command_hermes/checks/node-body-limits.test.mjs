// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const CAP = 20 * 1024 * 1024;
const photon = readFileSync(new URL('../plugins/platforms/photon/sidecar/index.mjs', import.meta.url), 'utf8');
// Extract only the pure reader: never import/start the sidecar or its SDK.
const start = photon.indexOf('const MAX_BODY_BYTES =');
const end = photon.indexOf('\nfunction unauthorized(', start);
assert.ok(start >= 0 && end > start);
const {readBody, cap} = vm.runInNewContext(`${photon.slice(start, end)}\n({readBody,cap:MAX_BODY_BYTES})`, {Buffer});
function request(bytes, width = 65537) {
  const value = {destroyed: false, destroy() { this.destroyed = true; }};
  value[Symbol.asyncIterator] = async function* () { for (let i=0; i<bytes.length; i+=width) yield bytes.subarray(i, i+width); };
  return value;
}
function jsonBytes(size) {
  const prefix = Buffer.from('{"text":"日本語');
  return Buffer.concat([prefix, Buffer.alloc(size-prefix.length-2, 0x61), Buffer.from('"}')]);
}
test('Photon reader transport cap is 20 MiB', () => assert.equal(cap, CAP));
for (const size of [CAP-1, CAP]) test(`Photon accepts ${size} bytes, split UTF-8 JSON chunks`, async () => {
  const req = request(jsonBytes(size), 65537);
  const result = await readBody(req);
  assert.ok(result.text.startsWith('日本語'));
  assert.equal(Buffer.byteLength(JSON.stringify(result)), size);
  assert.equal(req.destroyed, false);
});
test('Photon rejects 20 MiB + 1 and destroys the request', async () => {
  const req = request(jsonBytes(CAP+1));
  await assert.rejects(readBody(req), /request body too large/);
  assert.equal(req.destroyed, true);
});
test('Photon still accepts empty input and rejects malformed JSON', async () => {
  assert.equal(JSON.stringify(await readBody(request(Buffer.alloc(0)))), '{}');
  assert.equal((await readBody(request(Buffer.from('{"text":"日本語"}'),10))).text, '日本語');
  await assert.rejects(readBody(request(Buffer.from('{'))), /invalid JSON body/);
});
test('WhatsApp bridge passes numeric 20 MiB to express.json without importing/starting bridge', () => {
  const source = readFileSync(new URL('../scripts/whatsapp-bridge/bridge.js', import.meta.url), 'utf8');
  const registration = source.match(/app\.use\(express\.json\([^;]*\);/);
  assert.ok(registration);
  let options;
  const middleware = {};
  vm.runInNewContext(registration[0], {express:{json(value) {options=value;return middleware;}}, app:{use(value) {assert.equal(value,middleware);}}});
  assert.equal(options?.limit, CAP);
  // This is registration/config verification, not an Express parser integration test.
});
