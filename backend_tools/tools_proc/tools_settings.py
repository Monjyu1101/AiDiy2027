"""backend_tools の非秘密設定。起動時だけ読み込み、既存ファイルは変更しない。"""

import json
import logging
import os
from pathlib import Path
import tempfile

logger = logging.getLogger(__name__)
CONFIG_PATH = Path(__file__).resolve().parents[2] / "_config" / "AiDiy_tools.json"
DEFAULTS = {
    "text_to_speech": {"auto_provider": "edge", "auto_voice": "female"},
    "speech_to_text": {"auto_provider": "google"},
    "image_generation": {"auto_provider": "codex"},
    "movie_generation": {
        "auto_provider": "freeai",
        "auto_model": "veo-3.1-generate-preview",
        "auto_aspect_ratio": "16:9",
        "auto_resolution": "auto",
    },
}
CHOICES = {
    "text_to_speech": {
        "auto_provider": {"edge", "openai", "gemini", "freeai"},
        "auto_voice": {"female", "male"},
    },
    "speech_to_text": {"auto_provider": {"google", "openai"}},
    "image_generation": {"auto_provider": {"codex", "antigravity", "openai", "freeai", "gemini", "grok"}},
    "movie_generation": {
        "auto_provider": {"freeai", "gemini"},
        "auto_model": {"veo-3.1-generate-preview", "veo-2.0-generate-001", "veo-2.0-generate-exp"},
        "auto_aspect_ratio": {"16:9", "9:16"},
        "auto_resolution": {"auto", "720p", "1080p"},
    },
}


def load_tools_settings(path: Path = CONFIG_PATH) -> dict[str, dict[str, str]]:
    """未作成なら完成済みJSONを排他的に公開。不正設定は項目別に既定値へ戻す。"""
    result = {name: dict(values) for name, values in DEFAULTS.items()}
    temporary = None
    try:
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            # xモードだけでは並行起動側が書込途中のJSONを読むため、一時ファイルを
            # 完成させてからlinkする。replaceと違い既存の利用者設定を上書きしない。
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             prefix=".aidiy_tools-", suffix=".tmp", delete=False) as out:
                temporary = Path(out.name)
                json.dump(DEFAULTS, out, ensure_ascii=False, indent=2)
                out.write("\n")
                out.flush()
                os.fsync(out.fileno())
            try:
                os.link(temporary, path)
                logger.info("backend_tools 設定を初期生成: %s", path)
            except FileExistsError:
                pass  # 同時起動で先に生成された設定を読む。
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        logger.warning("backend_tools 設定を読込/生成できません。既定値を使用: %s (%s)", path, type(exc).__name__)
        return result
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                logger.warning("設定一時ファイルを削除できません: %s", temporary)
    if not isinstance(data, dict):
        logger.warning("backend_tools 設定はJSON objectが必要です。既定値を使用: %s", path)
        return result
    if data.keys() - (DEFAULTS.keys() | {"enabled"}):
        logger.warning("backend_tools 設定に未知の項目があります（無視）: %s", path)
    for name, fields in CHOICES.items():
        if name not in data:
            continue
        section = data[name]
        if not isinstance(section, dict):
            logger.warning("%s はJSON objectが必要です。既定値を使用", name)
            continue
        if section.keys() - fields.keys():
            logger.warning("%s に未知の項目があります（無視）", name)
        for field, allowed in fields.items():
            if field not in section:
                continue
            value = section[field]
            if isinstance(value, str) and value.strip().lower() in allowed:
                result[name][field] = value.strip().lower()
            else:
                logger.warning("%s.%s が不正です。既定値を使用", name, field)
    return result
