// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

// ConsoleのPTY子プロセスだけに適用する。OS・親プロセス・利用者の明示設定は変えない。
// Windowsの環境変数名は大文字小文字を区別しない。空文字や"0"も明示設定として残す。
export function consoleEnvironment(env = process.env, platform = process.platform) {
  const result = { ...env };
  if (platform === 'win32') {
    const names = new Set(Object.keys(result).map(name => name.toUpperCase()));
    for (const [name, value] of Object.entries({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' })) {
      if (!names.has(name)) result[name] = value;
    }
  }
  return result;
}
