/* COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
 * Licensed under "AiDiy 公開利用ライセンス v1.1".
 * Commercial use requires prior written consent from all copyright holders.
 * See LICENSE for full terms. https://github.com/monjyu1101/AiDiy2027 */
import { statSync } from 'node:fs';
export const folderRequired = '先にプロジェクトフォルダを開いてください';
/** URIだけが残ったフォルダや仮想ワークスペースを実行対象にしない。認証は別途維持する。 */
export function usableFolder(folder: { uri: { scheme: string; fsPath: string } } | undefined): boolean {
  try { return folder?.uri.scheme === 'file' && statSync(folder.uri.fsPath).isDirectory(); }
  catch { return false; }
}
