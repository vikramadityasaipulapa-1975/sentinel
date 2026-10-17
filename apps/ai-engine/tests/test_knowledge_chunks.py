from dataclasses import replace

from knowledge_catalog import digest, load_catalog
from knowledge_chunks import chunk_document


def test_chunks_are_exact_stable_bounded_and_version_specific():
    document = load_catalog()[0]
    chunks = chunk_document(document)
    assert len(chunks) == 6 and chunks == chunk_document(document)
    for chunk in chunks:
        assert document.content[chunk.start : chunk.end] == chunk.text
        assert len(chunk.text) <= 1400 and digest(chunk.text) == chunk.sha256
    assert chunks[0].id != chunk_document(replace(document, version=2))[0].id


def test_oversized_section_is_split_without_losing_characters():
    document = load_catalog()[0]
    body = "# Test\n\n## Checks\n" + "observation " * 400
    chunks = chunk_document(replace(document, content=body))
    assert len(chunks) > 1
    assert (
        "".join(row.text for row in chunks)
        == body[body.index("## Checks") + len("## Checks\n") :]
    )
