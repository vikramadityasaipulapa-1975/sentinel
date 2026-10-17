"""Deterministic section-aware passages with exact Unicode character offsets."""

import re
from dataclasses import dataclass

from knowledge_catalog import Document, digest

MAX_CHARS = 1400


@dataclass(frozen=True)
class Chunk:
    id: str
    document_id: str
    version: int
    ordinal: int
    section: str
    start: int
    end: int
    text: str
    sha256: str


def chunk_document(document: Document) -> list[Chunk]:
    chunks = []
    headings = list(re.finditer(r"^## (.+)$", document.content, re.MULTILINE))
    for index, heading in enumerate(headings):
        start = heading.end() + 1
        end = (
            headings[index + 1].start()
            if index + 1 < len(headings)
            else len(document.content)
        )
        while start < end:
            stop = min(start + MAX_CHARS, end)
            if stop < end:
                boundary = document.content.rfind(" ", start + MAX_CHARS // 2, stop)
                if boundary > start:
                    stop = boundary
            text = document.content[start:stop]
            if text.strip():
                ordinal = len(chunks)
                identity = digest(
                    f"{document.id}:{document.version}:{ordinal}:{digest(text)}"
                )
                chunks.append(
                    Chunk(
                        identity,
                        document.id,
                        document.version,
                        ordinal,
                        heading.group(1),
                        start,
                        stop,
                        text,
                        digest(text),
                    )
                )
            start = stop
    if not chunks or len(chunks) > 40:
        raise ValueError("Document chunk count outside bounds")
    return chunks
