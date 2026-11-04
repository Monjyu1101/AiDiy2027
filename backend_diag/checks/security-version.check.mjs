// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import test from 'node:test';
import assert from 'node:assert/strict';
import { SECURITY_RELEASES, securityVersionWarning, applySecurityVersionWarning } from '../診断/セキュリティバージョン.mjs';
import { probe } from '../診断/probes.mjs';

for (const [id, policy] of Object.entries(SECURITY_RELEASES)) {
  for (const fixed of policy.fixed) test(`${id} ${fixed} の直前・一致・以降`, () => {
    const parts = fixed.split('.').map(Number);
    assert.match(securityVersionWarning(id, [...parts.slice(0, 2), parts[2] - 1].join('.')), /バージョンが古い！.*セキュリティパッチ未対応/);
    assert.equal(securityVersionWarning(id, fixed), null);
    assert.equal(securityVersionWarning(id, [...parts.slice(0, 2), parts[2] + 1].join('.')), null);
    assert.ok(securityVersionWarning(id, `${fixed}-rc.1`));
  });
}
test('系列をまたぐ比較、未知・開発版、対象外を区別する', () => {
  for (const version of ['20.99.99', '23.99.99', '25.99.99', '24.20.0', '26.12.0']) assert.ok(securityVersionWarning('node', version));
  assert.ok(securityVersionWarning('python', '3.10.99'));
  assert.equal(securityVersionWarning('node', '24.100.0'), null);
  assert.equal(securityVersionWarning('python', '3.14.100'), null);
  assert.equal(securityVersionWarning('node', '27.0.0'), null);
  assert.equal(securityVersionWarning('python', '3.16.0'), null);
  assert.equal(securityVersionWarning('python', '3.16.0a1'), null);
  assert.equal(securityVersionWarning('python', '4.0.0'), null);
  assert.ok(securityVersionWarning('python', '3.13.18'));
  assert.ok(securityVersionWarning('node', '22.23.4'));
  assert.match(securityVersionWarning('python', null), /確認できません/);
  assert.equal(securityVersionWarning('npm', '1.0.0'), null);
});
test('未検出・実行失敗は保持し、古い版だけ注意になる', () => {
  for (const 状態 of ['ERR', 'NG', '未検出', '未確認']) {
    const value = { id:'python', 状態, バージョン:'3.14.9', 説明:'元の説明' };
    assert.equal(applySecurityVersionWarning(value), value);
  }
  const value = applySecurityVersionWarning({ id:'python', 状態:'OK', バージョン:'3.14.9', パス:'/python', 説明:'正常終了' });
  assert.equal(value.状態, '注意');
  assert.equal(value.パス, '/python');
  assert.match(value.説明, /正常終了/);
});
test('実probeのversion出力から注意を返す（起動失敗扱いにしない）', async () => {
  const result = await probe({ id:'python', version_args:['-e', 'console.log("Python 3.14.9")'], minimumVersion:'3.13' }, { resolve:async()=>process.execPath });
  assert.equal(result.状態, '注意');
  assert.equal(result.バージョン, '3.14.9');
  assert.match(result.説明, /3\.14\.10/);
  const fixed = await probe({ id:'python', version_args:['-e', 'console.log("Python 3.14.10")'] }, { resolve:async()=>process.execPath });
  assert.equal(fixed.状態, 'OK');
});
