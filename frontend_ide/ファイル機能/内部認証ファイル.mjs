// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027

/** Core/TaskTeam内部資格情報・秘密鍵リングだけを汎用ファイルAPIから除外する。通常のソース・説明書は対象外。 */
export function isInternalCredentialPath(path) {
  if (typeof path !== 'string') return false;
  // Windowsの大小文字・末尾の点/空白・代替データストリームでも同じファイルを指す。
  const name = path.split(/[\\/]/).at(-1).split(':', 1)[0].replace(/[. ]+$/, '');
  return /^(?:internal_auth(?:_keys)?\.json|\.internal_auth(?:_keys)?\.json\..+\.tmp)$/i.test(name);
}
