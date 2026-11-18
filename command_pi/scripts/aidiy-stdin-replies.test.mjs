import assert from 'node:assert/strict';
import test from 'node:test';
import { StdinBuffer } from '../packages/tui/src/stdin-buffer.ts';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture() {
 const buffer = new StdinBuffer(), data = [], paste = [];
 buffer.on('data', value => data.push(value));
 buffer.on('paste', value => paste.push(value));
 return { buffer, data, paste };
}
for (const [header, tail] of [['\x1b[6;', '4;34t'], ['\x1b[?', '1;2c'], ['\x1b[?', '7u']]) {
 test(`recognized terminal reply survives delayed tail ${JSON.stringify(header)}`, async () => {
  const { buffer, data } = fixture();
  try {
   buffer.process(header); await delay(220);
   assert.deepEqual(data, []);
   buffer.process(tail + '434');
   assert.deepEqual(data, [header + tail, '4', '3', '4']);
  } finally { buffer.destroy(); }
 });
}
test('reply cancellation and a new escape do not consume subsequent input', () => {
 for (const cancel of ['\x18', '\x1a', '\x1b[A']) {
  const { buffer, data } = fixture();
  try {
   buffer.process('\x1b[6;4;'); buffer.process(cancel + '434');
   assert.deepEqual(data, [...(cancel === '\x1b[A' ? [cancel] : []), '4', '3', '4']);
  } finally { buffer.destroy(); }
 }
});
test('literal numbers, Japanese, bracketed paste, keys and standalone Escape are preserved', async () => {
 const { buffer, data, paste } = fixture();
 try {
  buffer.process('434日本語\x1b[A\x1b[52u');
  assert.deepEqual(data, ['4', '3', '4', '日', '本', '語', '\x1b[A', '\x1b[52u']);
  buffer.process('\x1b[200~434\x1b[6;4;34t\x1b[201~');
  assert.deepEqual(paste, ['434\x1b[6;4;34t']);
  buffer.process('\x1b'); await delay(30);
  assert.equal(data.at(-1), '\x1b');
  buffer.process('\x1b['); await delay(80);
  assert.equal(data.at(-1), '\x1b[');
 } finally { buffer.destroy(); }
});
