# -*- coding: utf-8 -*-
#
# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""セットアップ／クリーンアップ共通の aidiy- 拡張解除処理。"""

from collections.abc import Callable


def aidiy_extension_ids(installed: set[str]) -> list[str]:
    """publisher にかかわらず、拡張名が aidiy- で始まる ID を返す。"""
    targets = set()
    for entry in installed:
        extension_id = entry.strip().lower().split("@", 1)[0]
        publisher, separator, name = extension_id.partition(".")
        if publisher and separator and name.startswith("aidiy-"):
            targets.add(extension_id)
    return sorted(targets)


def uninstall_aidiy_extensions(
    list_extensions: Callable[[], set[str] | None],
    uninstall: Callable[[str], bool],
    info: Callable[[str], None],
    error: Callable[[str], None],
) -> tuple[bool, int]:
    installed = list_extensions()
    if installed is None:
        error("aidiy- 拡張の一覧を取得できません。")
        return False, 0
    targets = aidiy_extension_ids(installed)
    if not targets:
        info("aidiy- で始まる vscode 拡張機能は配置されていません。")
        return True, 0
    for extension_id in targets:
        if not uninstall(extension_id):
            error(f"拡張機能の解除に失敗しました: {extension_id}")
            return False, 0
    installed_after = list_extensions()
    if installed_after is None:
        error("aidiy- 拡張の解除後の一覧を取得できません。")
        return False, 0
    remaining = aidiy_extension_ids(installed_after)
    if remaining:
        error(f"aidiy- 拡張の解除を確認できません: {', '.join(remaining)}")
        return False, 0
    info(f"vscode 拡張機能を解除しました: {', '.join(targets)}")
    return True, len(targets)
