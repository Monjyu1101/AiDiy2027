// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
/**
 * 共通コードサンプル読み込みスクリプト
 *
 * 使い方:
 * - HTMLで <pre><code data-src="sources/example.py"></code></pre> と記述
 * - common.js 側から本ファイルを読み込む
 */

document.addEventListener('DOMContentLoaded', async function () {
    const codeElements = document.querySelectorAll('code[data-src]');

    const loadText = async (src) => {
        const resolved = new URL(src, window.location.href).toString();
        try {
            const response = await fetch(resolved);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return await response.text();
        } catch (error) {
            if (window.location.protocol === 'file:') {
                return await new Promise((resolve, reject) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', resolved, true);
                    xhr.overrideMimeType('text/plain');
                    xhr.onload = () => {
                        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                            resolve(xhr.responseText);
                        } else {
                            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                        }
                    };
                    xhr.onerror = () => reject(new Error('XHR failed'));
                    xhr.send();
                });
            }
            throw error;
        }
    };

    for (const codeEl of codeElements) {
        const src = codeEl.getAttribute('data-src');
        if (!src) continue;

        try {
            const code = await loadText(src);
            codeEl.textContent = code;

            const ext = src.split('.').pop().toLowerCase();
            const langMap = {
                py: 'language-python',
                js: 'language-javascript',
                vue: 'language-vue',
                html: 'language-html',
                css: 'language-css',
                json: 'language-json',
                sql: 'language-sql',
                sh: 'language-bash',
                ps1: 'language-powershell'
            };
            if (langMap[ext]) {
                codeEl.classList.add(langMap[ext]);
            }

            const pre = codeEl.parentElement;
            if (pre && pre.tagName === 'PRE') {
                pre.setAttribute('data-loaded', 'true');

                if (!pre.querySelector('.code-filename')) {
                    const fileNameLabel = document.createElement('div');
                    fileNameLabel.className = 'code-filename';
                    fileNameLabel.textContent = src.split('/').pop();
                    pre.insertBefore(fileNameLabel, codeEl);
                }
            }
        } catch (error) {
            console.error(`Failed to load code from ${src}:`, error);
            codeEl.textContent = `コードの読み込みに失敗しました: ${src}\n${error.message}`;
            codeEl.style.color = '#dc3545';
        }
    }
});
