// COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
// Licensed under "AiDiy 公開利用ライセンス v1.1".
// Commercial use requires prior written consent from all copyright holders.
// See LICENSE for full terms. Thank you for keeping the rules.
// https://github.com/monjyu1101/AiDiy2027
// インストール専用テストは機能フォルダに内包します。
// 部品テストは画面モジュールを import() で読むため、先に Vue を ui/ の 1 実体へそろえる（ui-vue.cjs 参照）。
require('./ui-vue.cjs');
require('../diag/ui/components/導入状況/checks/導入状況パネル.check.cjs');
require('../diag/ui/components/導入状況/checks/導入状況状態.check.cjs');
