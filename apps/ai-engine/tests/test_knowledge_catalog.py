import json
import shutil

import pytest
from knowledge_catalog import ROOT, load_catalog


def test_curated_catalog_has_twelve_complete_versioned_documents():
    documents = load_catalog()
    assert len(documents) == 12 and len({row.id for row in documents}) == 12
    assert sum(row.kind == "fictional-postmortem" for row in documents) == 2
    assert all(len(row.sha256) == 64 and row.version == 1 for row in documents)


@pytest.mark.parametrize(
    "change", ["duplicate", "traversal", "missing-section", "unlabelled-example"]
)
def test_invalid_catalog_is_rejected_before_ingestion(tmp_path, change):
    root = tmp_path / "knowledge"
    shutil.copytree(ROOT, root)
    rows = json.loads((root / "manifest.json").read_text())
    if change == "duplicate":
        rows[1]["id"] = rows[0]["id"]
    elif change == "traversal":
        rows[0]["path"] = "../outside.md"
    elif change == "missing-section":
        path = root / rows[0]["path"]
        path.write_text(
            path.read_text().replace("## Checks", "## Other"), encoding="utf-8"
        )
    else:
        path = root / rows[-1]["path"]
        path.write_text(
            path.read_text()
            .replace("Fictional", "Example")
            .replace("fictional", "example"),
            encoding="utf-8",
        )
    (root / "manifest.json").write_text(json.dumps(rows), encoding="utf-8")
    with pytest.raises(ValueError):
        load_catalog(root)
