"""Pinned local ONNX embeddings; runtime never downloads or sends input remotely."""

import hashlib
import json
import math
import threading
from pathlib import Path

from knowledge_catalog import digest

REPO = Path(__file__).resolve().parents[2]
PROFILE = REPO / "knowledge/embedding-model.json"
DEFAULT_CACHE = REPO / ".artifacts/knowledge-model"


def vector_values(values):
    result = [float(value) for value in values]
    if len(result) != 384 or any(
        not math.isfinite(value) or abs(value) > 1e6 for value in result
    ):
        raise ValueError("Invalid embedding dimension or numeric value")
    norm = math.sqrt(sum(value * value for value in result))
    if norm < 1e-9:
        raise ValueError("Zero embedding")
    return [value / norm for value in result]


class LocalEmbedder:
    def __init__(self, cache: Path = DEFAULT_CACHE):
        from fastembed import TextEmbedding
        from tokenizers import Tokenizer

        profile = json.loads(PROFILE.read_text(encoding="utf-8"))
        cache = cache.resolve()
        for name, expected in profile["files"].items():
            path = cache / name
            if (
                not path.is_file()
                or hashlib.sha256(path.read_bytes()).hexdigest() != expected
            ):
                raise ValueError(
                    "Pinned embedding artifacts are missing or changed; prepare locally first"
                )
        fingerprint = digest(json.dumps(profile, sort_keys=True, separators=(",", ":")))
        self.model_id = profile["model"] + "@" + fingerprint
        self._lock = threading.Lock()
        self._tokenizer = Tokenizer.from_file(str(cache / "tokenizer.json"))
        self._tokenizer.no_truncation()
        self._tokenizer.no_padding()
        self._model = TextEmbedding(
            model_name=profile["model"],
            specific_model_path=str(cache),
            cache_dir=str(cache),
            local_files_only=True,
            threads=2,
            providers=["CPUExecutionProvider"],
        )

    def _check(self, texts):
        if not 1 <= len(texts) <= 800:
            raise ValueError("Embedding batch outside bounds")
        for text in texts:
            if (
                not isinstance(text, str)
                or not text.strip()
                or len(text) > 1800
                or len(self._tokenizer.encode(text).ids) > 512
            ):
                raise ValueError(
                    "Embedding text exceeds model budget; split the passage"
                )

    def embed(self, texts):
        self._check(texts)
        with self._lock:
            return [
                vector_values(row)
                for row in self._model.passage_embed(texts, batch_size=16)
            ]

    def query(self, text):
        self._check([text])
        with self._lock:
            return vector_values(next(iter(self._model.query_embed(text))))
