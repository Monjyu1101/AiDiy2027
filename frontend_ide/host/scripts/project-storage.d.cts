// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
export function projectRoot(project: string, aidiyRoot?: string): string;
export function programDataDirectory(project: string, programName: string, aidiyRoot?: string, children?: string[]): string;
export function preparePrivateDirectory(directory: string): string;
