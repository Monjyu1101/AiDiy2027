# -*- coding: utf-8 -*-
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027

"""AiDiy Hermes の手動モデル選択を、same/same 起動用に保存する。"""
import json
import logging
import os
from pathlib import Path
import tempfile

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)


def _valid_choice(value):
    if not isinstance(value, dict):
        return None
    provider, model = value.get('provider'), value.get('model')
    if not all(isinstance(item, str) and item.strip() and len(item) <= 256
               and not any(ord(c) < 32 for c in item) for item in (provider, model)):
        return None
    provider, model = provider.strip().lower(), model.strip()
    if provider in {'auto', 'same', 'unknown'} or model.lower() == 'unknown':
        return None
    return {'provider': provider, 'model': model}


def load_model_choice():
    try:
        return _valid_choice(json.loads((get_hermes_home() / 'aidiy_model.json').read_text(encoding='utf-8')))
    except (OSError, ValueError):
        return None


def save_model_choice(provider, model):
    choice = _valid_choice({'provider': provider, 'model': model})
    if choice is None:
        return False
    temporary = None
    try:
        target = get_hermes_home() / 'aidiy_model.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        # API キーは保存せず、読込時に現在の設定・認証ストアから解決する。
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent,
                                         prefix='aidiy_model-', suffix='.tmp', delete=False) as output:
            temporary = Path(output.name)
            json.dump(choice, output, ensure_ascii=False, indent=2)
            output.write('\n')
        os.replace(temporary, target)
        return True
    except OSError:
        logger.warning('AiDiy Hermes の前回モデル選択を保存できませんでした。')
        return False
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass


def model_display_name(model, provider=None):
    value = str(model or '').strip()
    provider = str(provider or '').strip()
    if value.lower() in {'auto', 'same'} and provider.lower() not in {'', 'auto', 'same', 'unknown'}:
        return f'{provider} ({value.lower()})'
    return '自動選択' if value.lower() in {'', 'auto', 'unknown', '(unknown)'} else value


def status_model_display_name(model, provider=None):
    """状態バー専用。実行用 ID は変えず provider/model を表示する。"""
    from hermes_cli.aidiy_model_catalog import catalog_key

    value = str(model or '').strip()
    slug = str(provider or '').strip().lower()
    key = catalog_key({'openai-codex': 'openai_oauth'}.get(slug, slug))
    if key in {'', 'auto', 'same', 'unknown'}:
        return model_display_name(value)
    # モデル自身の vendor/name は保持し、同じ provider 接頭辞だけ重複を防ぐ。
    prefix, separator, tail = value.partition('/')
    if separator and prefix in {slug, key}:
        value = tail
    label = value if value.lower() in {'auto', 'same'} else model_display_name(value)
    return f'{key}/{label}'
