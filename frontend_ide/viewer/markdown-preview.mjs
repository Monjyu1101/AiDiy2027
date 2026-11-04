// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
import {viewerActivityScript} from '../src/components/ファイル閲覧/閲覧待機.js';
import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });
markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const text = (tokens[index + 1]?.children || []).map(token => token.content).join('');
  const slug = text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-') || 'section';
  env.headings ??= new Map();
  const count = env.headings.get(slug) || 0;
  env.headings.set(slug, count + 1);
  tokens[index].attrSet('id', count ? `${slug}-${count}` : slug);
  return renderer.renderToken(tokens, index, options);
};
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  if (/^(https?:|mailto:)/i.test(tokens[index].attrGet('href') || '')) {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
  }
  return renderer.renderToken(tokens, index, options);
};

export const MAX_MARKDOWN_BYTES = 1024 * 1024;
export function markdownText(bytes) {
  for (const encoding of ['utf-8', 'shift_jis']) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch {}
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export function renderMarkdownDocument(text, title, nonce) {
  const escaped = markdown.utils.escapeHtml;
  const body = markdown.render(text, {});
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaped(title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0d1117;color:#e6edf3;font:14px/1.7 Arial,"Yu Gothic UI",sans-serif;overflow-wrap:anywhere}article{max-width:980px;margin:auto;padding:18px 20px}h1,h2,h3,h4,h5,h6{line-height:1.35;margin:1.4em 0 .65em}h1{font-size:1.8em}h2{font-size:1.45em}h1,h2{padding-bottom:.3em;border-bottom:1px solid #30363d}article>:first-child{margin-top:0}p,ul,ol,pre,table,blockquote{margin:0 0 16px}li>p{margin-bottom:6px}a{color:#79c0ff;text-underline-offset:3px}a:hover{text-decoration-thickness:2px}a:focus-visible{outline:2px solid #79c0ff}blockquote{border-left:4px solid #3d444d;padding:0 14px;color:#a8b3c2}pre{padding:12px;background:#161b22;border:1px solid #30363d;overflow:auto;white-space:pre}code{font:12px/1.6 Consolas,monospace;background:#21262d;padding:2px 4px}pre code{padding:0;background:transparent}table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}th,td{padding:6px 10px;border:1px solid #3d444d}th{background:#161b22}tr:nth-child(even){background:#161b2280}img{max-width:100%;height:auto}hr{height:1px;border:0;background:#30363d;margin:22px 0}
</style></head><body><article class="markdown-body">${body}</article><script nonce="${escaped(nonce)}">
${viewerActivityScript}
</script></body></html>`;
}
