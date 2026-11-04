// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// 共通コードローダーを必要なときだけ読み込む
const COMMON_SHARED_BASE_URL = (() => {
  const current = document.currentScript;
  if (current && current.src) {
    return new URL('.', current.src);
  }
  return new URL('./', window.location.href);
})();

document.addEventListener('DOMContentLoaded', () => {
  const hasExternalCode = document.querySelector('code[data-src]');
  if (!hasExternalCode) return;

  const existingLoader = document.querySelector(
    'script[data-code-loader], script[data-code-loader-shared], script[src*="code-loader.js"]'
  );
  if (existingLoader) return;

  const script = document.createElement('script');
  script.src = new URL('code-loader.js', COMMON_SHARED_BASE_URL).toString();
  script.defer = true;
  script.setAttribute('data-code-loader-shared', 'true');
  document.head.appendChild(script);
});

// コピーボタン機能
document.addEventListener('DOMContentLoaded', () => {
  const preElements = document.querySelectorAll('pre');

  preElements.forEach(pre => {
    const button = document.createElement('button');
    button.className = 'copy-btn';
    button.innerHTML = 'コピー';
    button.setAttribute('aria-label', 'コードをコピー');

    button.addEventListener('click', async () => {
      const code = pre.querySelector('code') || pre;
      const text = code.textContent;

      try {
        await navigator.clipboard.writeText(text);
        button.innerHTML = 'コピーしました';
        button.classList.add('copied');

        setTimeout(() => {
          button.innerHTML = 'コピー';
          button.classList.remove('copied');
        }, 2000);
      } catch (err) {
        console.error('コピーに失敗しました:', err);
        button.innerHTML = '失敗';
        setTimeout(() => {
          button.innerHTML = 'コピー';
        }, 2000);
      }
    });

    pre.appendChild(button);
  });
});

// スムーズスクロール
document.addEventListener('DOMContentLoaded', () => {
  const links = document.querySelectorAll('a[href^="#"]');

  links.forEach(link => {
    link.addEventListener('click', (e) => {
      const href = link.getAttribute('href');
      if (href === '#') return;

      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });

        history.pushState(null, null, href);
      }
    });
  });
});

// ページ読み込み時にハッシュがあればスクロール
window.addEventListener('load', () => {
  if (window.location.hash) {
    const target = document.querySelector(window.location.hash);
    if (target) {
      setTimeout(() => {
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }, 100);
    }
  }
});

// details開閉の操作性向上
document.addEventListener('DOMContentLoaded', () => {
  const details = document.querySelectorAll('details');

  details.forEach(detail => {
    const summary = detail.querySelector('summary');
    if (summary) {
      summary.style.cursor = 'pointer';
      summary.style.userSelect = 'none';
    }
  });
});

// 読了進捗バー
document.addEventListener('DOMContentLoaded', () => {
  const progressBar = document.createElement('div');
  progressBar.style.position = 'fixed';
  progressBar.style.top = '0';
  progressBar.style.left = '0';
  progressBar.style.width = '0%';
  progressBar.style.height = '3px';
  progressBar.style.background = 'linear-gradient(to right, #3498db, #2ecc71)';
  progressBar.style.zIndex = '9999';
  progressBar.style.transition = 'width 0.2s ease';
  document.body.appendChild(progressBar);

  window.addEventListener('scroll', () => {
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight - windowHeight;
    const scrolled = window.scrollY;
    const progress = (scrolled / documentHeight) * 100;
    progressBar.style.width = progress + '%';
  });
});

// 印刷時の最適化
window.addEventListener('beforeprint', () => {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.style.display = 'none';
  });
});

window.addEventListener('afterprint', () => {
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.style.display = 'flex';
  });
});
