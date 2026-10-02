#!/usr/bin/env python3
"""Download the real OpenStreetMap extract for Darsi, Prakasam, Andhra Pradesh (523247).

The script is dependency-free (stdlib only) and is executed by
.github/workflows/fetch-osm.yml, because the development sandbox has no route to
the Overpass servers.  The raw answer is stored verbatim in data/osm/darsi_raw.json
so that every downstream artefact is reproducible and auditable.

Data (c) OpenStreetMap contributors, licensed under the ODbL.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Town centre of Darsi (OSM place node 3319071258).
ANCHOR_LAT = 15.7667
ANCHOR_LON = 79.6833

# ~4.4 km x 4.4 km window around the town centre.
HALF_LAT = 0.0200
HALF_LON = 0.0208

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

USER_AGENT = "DarsiGame/0.2 (OSM import for an open-source game; contact via GitHub repo)"


def bbox(half_lat: float = HALF_LAT, half_lon: float = HALF_LON) -> tuple[float, float, float, float]:
    return (
        ANCHOR_LAT - half_lat,
        ANCHOR_LON - half_lon,
        ANCHOR_LAT + half_lat,
        ANCHOR_LON + half_lon,
    )


def build_query(b: tuple[float, float, float, float]) -> str:
    s, w, n, e = b
    box = f"{s},{w},{n},{e}"
    return f"""
[out:json][timeout:600];
(
  way["highway"]({box});
  way["building"]({box});
  way["waterway"]({box});
  way["natural"]({box});
  way["landuse"]({box});
  way["leisure"]({box});
  way["amenity"]({box});
  way["man_made"]({box});
  way["barrier"]({box});
  way["railway"]({box});
  node["place"]({box});
  node["amenity"]({box});
  node["shop"]({box});
  node["tourism"]({box});
  node["historic"]({box});
  node["man_made"]({box});
  node["natural"]({box});
  node["highway"="traffic_signals"]({box});
  node["power"="tower"]({box});
  relation["building"]({box});
  relation["natural"]({box});
  relation["landuse"]({box});
  relation["waterway"]({box});
);
out tags geom;
""".strip()


def fetch(query: str, retries: int = 6) -> dict:
    payload = urllib.parse.urlencode({"data": query}).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(retries):
        endpoint = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            print(f"[{attempt + 1}/{retries}] POST {endpoint}", file=sys.stderr)
            request = urllib.request.Request(
                endpoint,
                data=payload,
                headers={"User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded"},
            )
            with urllib.request.urlopen(request, timeout=620) as response:
                raw = response.read().decode("utf-8")
            document = json.loads(raw)
            if "elements" not in document:
                raise ValueError(f"no elements in answer: {raw[:300]}")
            if not document["elements"]:
                raise ValueError("Overpass returned an empty element list")
            print(f"received {len(document['elements'])} elements", file=sys.stderr)
            return document
        except Exception as error:  # noqa: BLE001 - we really do want to try the next mirror
            last_error = error
            print(f"  failed: {error}", file=sys.stderr)
            time.sleep(10 + 10 * attempt)
    raise SystemExit(f"all Overpass endpoints failed, last error: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("data/osm/darsi_raw.json"))
    args = parser.parse_args()

    b = bbox()
    document = fetch(build_query(b))
    document["darsi_request"] = {
        "anchor": {"lat": ANCHOR_LAT, "lon": ANCHOR_LON},
        "bbox": {"south": b[0], "west": b[1], "north": b[2], "east": b[3]},
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    size_mb = args.output.stat().st_size / 1_000_000
    print(f"wrote {args.output} ({size_mb:.2f} MB, {len(document['elements'])} elements)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
