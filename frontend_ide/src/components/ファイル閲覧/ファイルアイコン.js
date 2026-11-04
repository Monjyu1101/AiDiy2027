// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// SVGはCatppuccin IconsのMIT素材。出典・原文はpublic/assets/catppuccin_icons/。
// 名前はこの集合からだけ返す。プロジェクト内のファイル名をURLに連結しない。
export const CATPPUCCIN_ROOT = 'assets/catppuccin_icons/';
export const ICON_NAMES = Object.freeze(["_file", "_folder", "_folder_open", "xml", "text", "readme", "license", "json", "config", "env", "database", "image", "audio", "video", "zip", "binary", "3d", "font", "csv", "lock", "markdown", "batch"]);
const named = new Map();
function names(icon, values) { for (const name of values.split(' ')) named.set(name, icon); }
names('readme', 'readme readme.md readme.rst readme.txt');
names('license', 'license licence copying copyright unlicense license.md license.txt licence.md licence.txt copying.md copying.txt copyright.md copyright.txt notice notice.md notice.txt');
names('lock', 'package-lock.json npm-shrinkwrap.json yarn.lock pnpm-lock.yaml poetry.lock uv.lock cargo.lock');
names('config', 'dockerfile containerfile makefile cmakelists.txt requirements.txt .gitignore .gitattributes .gitmodules .dockerignore .vscodeignore .editorconfig .npmrc .yarnrc');
names('env', '.env .env.local .env.development .env.production .env.test .env.example .env.sample .env.template');

const extensions = new Map();
function types(icon, values) { for (const extension of values.split(' ')) extensions.set(extension, icon); }
types('xml', 'py pyw pyi ipynb js mjs cjs jsx ts mts cts tsx vue svelte html htm xhtml xml xsd xsl xslt css scss sass less c h cc cpp cxx hpp cs java kt kts go rs rb php swift m mm r lua pl dart ex exs erl fs fsx clj cljs scala groovy asm s sol graphql gql proto');
types('batch', 'sh bash zsh fish bat cmd ps1 psm1 psd1');
types('markdown', 'md markdown mdx rst');
types('text', 'txt log rtf doc docx odt pdf ppt pptx odp tex sty bib bst tmpl jinja jinja2 fixture');
types('json', 'json jsonc json5 jsonl ndjson map');
types('config', 'yaml yml toml ini cfg conf cnf properties service example');
types('env', 'env');
types('database', 'sql db sqlite sqlite3 mdb accdb');
types('image', 'png jpg jpeg gif svg ico webp bmp tif tiff avif heic psd');
types('audio', 'mp3 wav ogg oga opus aac m4a flac aiff mid midi');
types('video', 'mp4 webm mov avi mkv m4v wmv ogv');
types('zip', 'zip 7z rar tar gz tgz bz2 tbz2 xz zst');
types('binary', 'bin exe dll so dylib wasm pyc pyo class onnx tflite pt pth safetensors');
types('3d', 'vrm vrma glb gltf obj fbx stl blend');
types('font', 'woff woff2 ttf otf eot');
types('csv', 'csv tsv xls xlsx ods');
types('lock', 'lock');
// 最長の複合拡張子を先に調べる（例: model.d.ts、settings.json.template）。
for (const [suffix, icon] of Object.entries({
  'd.ts': 'xml', 'd.mts': 'xml', 'd.cts': 'xml',
  'tar.gz': 'zip', 'tar.bz2': 'zip', 'tar.xz': 'zip', 'tar.zst': 'zip',
  'json.template': 'json', 'json.example': 'json', 'json.sample': 'json',
  'yaml.template': 'config', 'yaml.example': 'config', 'yml.example': 'config',
  'xml.dist.sample': 'xml', 'xml.dist': 'xml',
})) extensions.set(suffix, icon);

export function fileIcon(name, { directory = false, open = false } = {}) {
  if (directory) return open ? '_folder_open' : '_folder';
  const basename = typeof name === 'string' ? name.replaceAll('\\', '/').split('/').at(-1).toLowerCase() : '';
  if (named.has(basename)) return named.get(basename);
  // .envの環境別名だけは拡張子より前に扱う。内容や任意のURLは読まない。
  if (basename.startsWith('.env.')) return 'env';
  const parts = basename.split('.');
  for (let index = 1; index < parts.length; index++) {
    const icon = extensions.get(parts.slice(index).join('.'));
    if (icon) return icon;
  }
  return '_file';
}

// HTTP配信も明示した同梱ファイルだけを許可。..、未知SVG、任意階層は一致しない。
const assets = new Map(ICON_NAMES.map(name => [`${CATPPUCCIN_ROOT}mocha/${name}.svg`, 'image/svg+xml']));
for (const name of ['LICENSE', 'SOURCE.md', 'MARKDOWN_LICENSE']) assets.set(CATPPUCCIN_ROOT + name, 'text/plain; charset=utf-8');
assets.set(CATPPUCCIN_ROOT + 'manifest.json', 'application/json; charset=utf-8');
export function catppuccinAsset(path) {
  const type = assets.get(path);
  return type ? [path, type] : undefined;
}
