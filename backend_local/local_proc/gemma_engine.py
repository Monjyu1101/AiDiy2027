# -*- coding: utf-8 -*-

# -------------------------------------------------------------------------
# COPYRIGHT (C) 2014-2027 Mitsuo KONDOU and contributors.
# Licensed under "AiDiy 公開利用ライセンス v1.1".
# Commercial use requires prior written consent from all copyright holders.
# See LICENSE for full terms. Thank you for keeping the rules.
# https://github.com/monjyu1101/AiDiy2027
# -------------------------------------------------------------------------

"""
HuggingFace Gemma 推論エンジン

transformers を用いて Gemma 系モデルをロードし、OpenAI ChatCompletion 形式の
messages から応答テキストを生成する。

- text 専用 Gemma（gemma-2-*, gemma-3-1b）と マルチモーダル Gemma3（gemma-3-4b/12b/27b）の
  両方に対応する（テキスト入力のみ利用）。
- モデルロードは初回の generate 呼び出し時（または明示的な load()）に行う遅延ロード方式。
- スレッドセーフ: モデルは 1 インスタンスを共有し、生成は内部ロックで直列化する。
"""

import os
import threading
from typing import Any, Optional

from log_config import get_logger
from local_proc.model_paths import default_models_dir, local_dir_for

logger = get_logger(__name__)


class GemmaEngineError(RuntimeError):
    """モデルロード/推論に関するエラー。"""


def _resolve_device(device: str) -> str:
    """device 指定（auto/cpu/cuda）を実際のデバイス文字列へ解決する。"""
    if device and device != "auto":
        return device
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _resolve_dtype(dtype_name: str, device: str):
    """dtype 指定を torch.dtype へ解決する。auto は device に応じて選ぶ。"""
    import torch
    mapping = {
        "float32": torch.float32,
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
    }
    if dtype_name and dtype_name != "auto":
        return mapping.get(dtype_name, torch.float32)
    # auto: GPU は bfloat16、CPU は float32（CPU の半精度は遅く不安定なため）
    return torch.bfloat16 if device == "cuda" else torch.float32


class GemmaEngine:
    """Gemma モデルを遅延ロードして OpenAI 形式の生成を提供するエンジン。"""

    def __init__(
        self,
        model_id: str,
        device: str = "auto",
        dtype: str = "auto",
        hf_token: Optional[str] = None,
        max_new_tokens: int = 128000,
        models_dir: Optional[str] = None,
        offline: bool = False,
    ):
        self.model_id = model_id
        # device 未指定 / "auto" のときは GPU 失敗時に CPU へ自動フォールバックする
        self._device_auto = (not device) or (device == "auto")
        self.device = _resolve_device(device)
        self.dtype_name = dtype
        self.hf_token = hf_token or None
        self.default_max_new_tokens = max_new_tokens
        self.models_dir = models_dir or default_models_dir()
        # offline=True なら未ダウンロード時にハブへ取りに行かずエラーにする
        self.offline = offline

        self._tokenizer = None
        self._model = None
        self._tc_open_id = None
        self._tc_close_id = None
        self._loaded = False
        self._load_error: Optional[str] = None
        self._lock = threading.Lock()  # 生成の直列化 + ロードの排他
        # API 層の同時実行ガード（生成中の新規要求を待たせず即 busy 応答するため）
        self._request_gate = threading.Lock()

    # ------------------------------------------------------------------ #
    # 同時実行ガード（生成中の二重要求を弾く）
    # ------------------------------------------------------------------ #

    def try_acquire_slot(self) -> bool:
        """生成スロットを非ブロッキングで確保する。確保できれば True。"""
        return self._request_gate.acquire(blocking=False)

    def release_slot(self) -> None:
        """生成スロットを解放する。"""
        try:
            self._request_gate.release()
        except RuntimeError:
            pass

    @property
    def is_busy(self) -> bool:
        return self._request_gate.locked()

    def resolve_source(self) -> tuple[str, bool]:
        """ロード元（パスまたは repo_id）と local_files_only を解決する。

        優先順位:
        1. model_id 自体が既存ディレクトリ → そのパスをローカルロード。
        2. temp/models/<safe_name> に config.json がある → そのパスをローカルロード。
        3. いずれも無ければ repo_id でハブからダウンロード（offline 時は不可）。
        """
        if os.path.isdir(self.model_id) and os.path.isfile(
            os.path.join(self.model_id, "config.json")
        ):
            return self.model_id, True

        local_dir = local_dir_for(self.model_id, self.models_dir)
        if os.path.isfile(os.path.join(local_dir, "config.json")):
            return local_dir, True

        return self.model_id, bool(self.offline)

    # ------------------------------------------------------------------ #
    # ロード
    # ------------------------------------------------------------------ #

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    @property
    def load_error(self) -> Optional[str]:
        return self._load_error

    def load(self) -> None:
        """モデルとトークナイザをロードする（既にロード済みなら何もしない）。"""
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            try:
                self._do_load()
                self._loaded = True
                self._load_error = None
                logger.info("Gemma モデルのロード完了: %s (device=%s)", self.model_id, self.device)
            except Exception as e:  # noqa: BLE001
                self._load_error = str(e)
                logger.error("Gemma モデルのロードに失敗: %s", e)
                raise GemmaEngineError(str(e)) from e

    def _do_load(self) -> None:
        from transformers import AutoTokenizer

        torch_dtype = _resolve_dtype(self.dtype_name, self.device)
        source, local_only = self.resolve_source()
        logger.info(
            "Gemma モデルをロードします: source=%s (local_files_only=%s) device=%s dtype=%s",
            source, local_only, self.device, torch_dtype,
        )

        token = self.hf_token
        # ローカルパスからロードする場合は token / cache_dir は不要。
        # repo_id からダウンロードする場合は temp/models をキャッシュ先に使う。
        common_kwargs: dict[str, Any] = {"local_files_only": local_only}
        if not local_only:
            common_kwargs["token"] = token
            common_kwargs["cache_dir"] = self.models_dir

        self._tokenizer = AutoTokenizer.from_pretrained(source, **common_kwargs)

        # Gemma function calling のマーカートークン ID を解決（無ければ None）
        def _tid(token: str):
            try:
                ids = self._tokenizer.encode(token, add_special_tokens=False)
                return ids[0] if len(ids) == 1 else None
            except Exception:
                return None
        self._tc_open_id = _tid("<|tool_call>")
        self._tc_close_id = _tid("<tool_call|>")

        # text 専用と マルチモーダル(ConditionalGeneration) の両対応。
        # まず CausalLM を試し、アーキテクチャ非対応なら ImageTextToText にフォールバック。
        model = None
        last_err: Optional[Exception] = None
        from transformers import AutoModelForCausalLM
        try:
            model = AutoModelForCausalLM.from_pretrained(
                source,
                dtype=torch_dtype,
                low_cpu_mem_usage=True,
                **common_kwargs,
            )
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.info("AutoModelForCausalLM 不可。ImageTextToText を試行します: %s", e)
            try:
                from transformers import AutoModelForImageTextToText
                model = AutoModelForImageTextToText.from_pretrained(
                    source,
                    dtype=torch_dtype,
                    low_cpu_mem_usage=True,
                    **common_kwargs,
                )
            except Exception as e2:  # noqa: BLE001
                raise GemmaEngineError(
                    f"モデルロード失敗: CausalLM={last_err} / ImageTextToText={e2}"
                ) from e2

        # デバイス配置。auto 解決で cuda を選んだが GPU 配置に失敗（OOM/ドライバ等）した
        # 場合は CPU へフォールバックする（明示 cuda 指定時はフォールバックせず raise）。
        try:
            model = model.to(self.device)
        except Exception as e:  # noqa: BLE001
            if self._device_auto and self.device == "cuda":
                import torch
                logger.warning("GPU 配置に失敗したため CPU にフォールバックします: %s", e)
                try:
                    torch.cuda.empty_cache()
                except Exception:
                    pass
                self.device = "cpu"
                # CPU では半精度が遅く不安定なため float32 へ変換して配置する
                model = model.to(device="cpu", dtype=torch.float32)
            else:
                raise

        model.eval()
        self._model = model

    # ------------------------------------------------------------------ #
    # 生成
    # ------------------------------------------------------------------ #

    @staticmethod
    def _normalize_messages(messages: list[dict]) -> list[dict]:
        """OpenAI messages を Gemma チャットテンプレート向けに正規化する。

        - content が文字列ならそのまま使用。
        - content がパート配列（OpenAI vision 形式）なら text パートのみ連結する
          （本サーバーはテキスト生成専用のため画像は無視する）。
        - function calling 用に tool_calls / tool_call_id / name は保持する。
        """
        norm: list[dict] = []
        for m in messages:
            role = m.get("role", "user")
            content = m.get("content", "")
            if isinstance(content, list):
                texts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        texts.append(str(part.get("text", "")))
                    elif isinstance(part, str):
                        texts.append(part)
                content = "\n".join(texts)
            item: dict[str, Any] = {"role": role, "content": content if content is not None else ""}
            # tool 関連フィールドを保持（self-loop の多段ツール対話用）
            if m.get("tool_calls"):
                item["tool_calls"] = m["tool_calls"]
                # assistant の tool_calls 時は content が None でも可
                if not content:
                    item["content"] = None
            if m.get("tool_call_id"):
                item["tool_call_id"] = m["tool_call_id"]
            if m.get("name"):
                item["name"] = m["name"]
            # content を文字列化（tool_calls 保持時は None を許容）
            if item.get("content") is not None and not isinstance(item["content"], str):
                item["content"] = str(item["content"])
            norm.append(item)
        return norm

    def _apply_chat_template(self, messages: list[dict], tools: Optional[list] = None):
        """チャットテンプレートを適用し、モデル入力（input_ids / attention_mask）を返す。

        transformers のバージョンにより戻り値が dict（BatchEncoding）の場合と
        テンソル単体の場合があるため、常に dict 形式へ正規化して返す。
        tools を渡すと Gemma の function calling 用にツール定義をプロンプトへ埋め込む。
        system ロール非対応モデル（gemma-2 系）では、system を先頭 user に統合して再試行する。
        """
        tok = self._tokenizer

        def _build(msgs):
            kwargs: dict[str, Any] = dict(
                add_generation_prompt=True,
                return_tensors="pt",
                return_dict=True,
            )
            if tools:
                kwargs["tools"] = tools
            out = tok.apply_chat_template(msgs, **kwargs)
            # 念のためテンソル単体で返る実装にも対応する
            if hasattr(out, "shape"):
                return {"input_ids": out}
            return out

        try:
            return _build(messages)
        except Exception as e:  # noqa: BLE001
            if not any(m.get("role") == "system" for m in messages):
                raise
            logger.info("system ロール非対応のため先頭 user に統合して再試行します: %s", e)
            return _build(self._merge_system_into_user(messages))

    @staticmethod
    def _merge_system_into_user(messages: list[dict]) -> list[dict]:
        system_texts = [m["content"] for m in messages if m.get("role") == "system"]
        rest = [m for m in messages if m.get("role") != "system"]
        if not system_texts:
            return rest
        prefix = "\n".join(system_texts).strip()
        for i, m in enumerate(rest):
            if m.get("role") == "user":
                rest[i] = {"role": "user", "content": f"{prefix}\n\n{m['content']}"}
                return rest
        # user が無ければ user メッセージとして先頭に追加
        return [{"role": "user", "content": prefix}] + rest

    def generate(
        self,
        messages: list[dict],
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        tools: Optional[list] = None,
    ) -> dict[str, Any]:
        """messages から応答を生成し、テキストとトークン使用量を返す。

        tools を渡すと Gemma function calling を有効化し、モデルがツール呼び出しを
        出力した場合は OpenAI 形式の tool_calls を返す。

        Returns:
            {"content": str, "tool_calls": list|None,
             "prompt_tokens": int, "completion_tokens": int}
        """
        if not self._loaded:
            self.load()

        import torch

        norm = self._normalize_messages(messages)
        max_new = int(max_tokens) if max_tokens else self.default_max_new_tokens

        # 生成は GPU/モデル状態の競合を避けるため直列化する
        with self._lock:
            inputs = self._apply_chat_template(norm, tools=tools).to(self._model.device)
            prompt_len = int(inputs["input_ids"].shape[-1])

            gen_kwargs: dict[str, Any] = {
                "max_new_tokens": max_new,
            }
            if temperature is not None and temperature > 0:
                gen_kwargs.update(
                    do_sample=True,
                    temperature=float(temperature),
                    top_p=float(top_p) if top_p is not None else 0.95,
                )
            else:
                gen_kwargs.update(do_sample=False)

            with torch.inference_mode():
                output = self._model.generate(**inputs, **gen_kwargs)

            gen_ids = output[0][prompt_len:]
            completion_len = int(gen_ids.shape[-1])
            content, tool_calls = self._split_content_and_tools(gen_ids, with_tools=bool(tools))

        return {
            "content": content,
            "tool_calls": tool_calls or None,
            "prompt_tokens": prompt_len,
            "completion_tokens": completion_len,
        }

    def _split_content_and_tools(self, gen_ids, with_tools: bool):
        """生成トークン列から、自然言語の content と tool_calls を分離する。

        tool_call マーカー（特殊トークン）で囲まれた区間をトークン ID 単位で切り出し、
        その区間は Gemma 独自フォーマットをパースして tool_calls 化する。
        残りのトークンを skip_special_tokens=True でデコードして content とする。
        """
        ids = gen_ids.tolist() if hasattr(gen_ids, "tolist") else list(gen_ids)

        open_id = self._tc_open_id
        close_id = self._tc_close_id
        if not with_tools or open_id is None or close_id is None or open_id not in ids:
            text = self._tokenizer.decode(ids, skip_special_tokens=True).strip()
            return text, []

        from local_proc.gemma_tools import parse_tool_calls

        content_ids: list[int] = []
        tool_call_blocks: list[str] = []
        i = 0
        n = len(ids)
        while i < n:
            if ids[i] == open_id:
                # close まで（含む）を tool_call ブロックとして収集
                j = i + 1
                inner: list[int] = []
                while j < n and ids[j] != close_id:
                    inner.append(ids[j])
                    j += 1
                inner_text = self._tokenizer.decode(inner, skip_special_tokens=False)
                tool_call_blocks.append(inner_text)
                i = j + 1  # close_id をスキップ
            else:
                content_ids.append(ids[i])
                i += 1

        content = self._tokenizer.decode(content_ids, skip_special_tokens=True).strip()
        # 各ブロックを `<|tool_call>...<tool_call|>` 形に戻してまとめてパース
        raw = "".join(f"<|tool_call>{b}<tool_call|>" for b in tool_call_blocks)
        tool_calls = parse_tool_calls(raw)
        return content, tool_calls
