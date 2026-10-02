import json
import math
from pathlib import Path

ROOT = Path(__file__).parents[1]


def project_point(lat, lon, anchor_lat=15.7667, anchor_lon=79.6833):
    return (
        (lon - anchor_lon) * 111320.0 * math.cos(math.radians(anchor_lat)),
        -(lat - anchor_lat) * 110540.0,
    )


def test_manifest_has_real_place_anchor_and_roads():
    data = json.loads((ROOT / "data/darsi_map.json").read_text())
    assert data["place"]["pin"] == "523247"
    assert abs(data["place"]["anchor"]["lat"] - 15.7667) < 0.001
    assert abs(data["place"]["anchor"]["lon"] - 79.6833) < 0.001
    assert len(data["roads"]) >= 5
    assert all(len(road["points"]) >= 2 for road in data["roads"])


def test_projection_preserves_small_town_scale():
    data = json.loads((ROOT / "data/darsi_map.json").read_text())
    points = [project_point(*point) for road in data["roads"] for point in road["points"]]
    assert max(x for x, _ in points) < 3000
    assert min(x for x, _ in points) > -3000
    assert max(z for _, z in points) < 3000
    assert min(z for _, z in points) > -3000


def test_accuracy_boundary_is_explicit():
    provenance = json.loads((ROOT / "data/darsi_map.json").read_text())["provenance"]
    assert provenance["verified"]
    assert provenance["procedural_or_unverified"]
