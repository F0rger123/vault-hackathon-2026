"""F11.6: dataset v2 adds new planted conflicts without touching any v1 file."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V1 = ROOT / "data" / "synthetic" / "v1"
V2 = ROOT / "data" / "synthetic" / "v2"


def test_v2_is_a_superset_of_v1_with_identical_shared_files():
    v1 = {p.name: p.read_bytes() for p in (V1 / "files").iterdir()}
    v2 = {p.name: p for p in (V2 / "files").iterdir()}
    assert set(v1) <= set(v2) and len(v2) - len(v1) == 15
    changed = [n for n, data in v1.items() if not n.endswith(".png") and v2[n].read_bytes() != data]
    assert changed == []


def test_v2_plants_quantity_and_material_conflicts_in_every_project():
    m = json.loads((V2 / "manifest.json").read_text(encoding="utf-8"))
    assert m["generator"] == "vault-synthetic-v2" and m["fictional"] is True
    for kind in ("quantity_conflict", "material_conflict"):
        planted = [a for a in m["anomalies"] if a["kind"] == kind]
        assert len(planted) == 5 and len({a["project"] for a in planted}) == 5
        for a in planted:
            assert len(set(a["values"])) == 2 and len(a["documents"]) >= 2
    scanned = [d for d in m["documents"] if d["layout"] == "scanned"]
    assert len(scanned) == 5 and all(d["filename"].endswith(".pdf") for d in scanned)
