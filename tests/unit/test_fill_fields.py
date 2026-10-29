"""F04.11: quantities and materials the model left empty are filled from the part's own line, never overridden."""

from backend.providers.fill_fields import fill_from_text
from backend.providers.schema import Component, Extraction

CONTRACT = "   HX-8226  Plate heat exchanger  316L stainless  rated 150 psi  quantity 4\n   FL-6696  Weld-neck flange  rated 900 psi"
BOM = "part_number,description,material,rated_psi,qty\nFL-8494,Weld-neck flange,A105 carbon steel,2500 psi,5"


def test_fills_only_empty_fields_with_a_quote():
    model = Extraction(
        doc_type="contract",
        components=[
            Component(part_number="HX-8226", pressure_rating_psi=150, material="316L stainless"),
            Component(part_number="FL-6696", pressure_rating_psi=900),
            Component(part_number="FL-8494", material="Duplex 2205"),
        ],
    )
    out, filled = fill_from_text(model, [CONTRACT, BOM])
    got = {c.part_number: c for c in out.components}
    assert got["HX-8226"].quantity == 4 and got["HX-8226"].pressure_rating_psi == 150
    assert got["FL-6696"].quantity is None  # no labelled quantity on its line: left empty, not guessed
    assert got["FL-8494"].quantity == 5 and got["FL-8494"].material == "Duplex 2205"  # model's material kept
    assert filled == 2
    quotes = {e.field: e.quote for e in out.evidence}
    assert "quantity 4" in quotes["components.HX-8226.quantity"]
    assert quotes["components.FL-8494.quantity"].startswith("FL-8494,")


def test_nothing_to_fill_returns_the_same_object():
    model = Extraction(doc_type="contract", components=[Component(part_number="HX-8226", quantity=4, material="x")])
    out, filled = fill_from_text(model, [CONTRACT])
    assert out is model and filled == 0
