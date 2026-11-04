// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
document.addEventListener('DOMContentLoaded', () => {
  const blocks = document.querySelectorAll('pre[data-src]');
  blocks.forEach(async (block) => {
    const src = block.getAttribute('data-src');
    const code = block.querySelector('code');
    if (!src || !code) return;

    try {
      const response = await fetch(src, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const text = await response.text();
      code.textContent = text.replace(/\s+$/u, '');
      block.classList.add('loaded');
    } catch (error) {
      code.textContent = `読み込みに失敗しました: ${src}`;
      block.classList.add('error');
    }
  });
});

