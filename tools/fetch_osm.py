#!/usr/bin/env python3
"""Download the real OpenStreetMap extract for Darsi, Prakasam district, Andhra Pradesh (PIN 523247).

Runs inside GitHub Actions because the development sandbox has no route to the
Overpass servers.  The raw Overpass answer is stored verbatim so every
downstream artefact is reproducible and auditable.

Data (c) OpenStreetMap contributors, licensed under the ODbL 1.0.
https://www.openstreetmap.org/copyright
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Darsi town centre -- OSM place node 3319071258.
ANCHOR_LAT = 15.7694505
ANCHOR_LON = 79.6776541

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]

USER_AGENT = "DarsiGame/0.3 (open-source game world build; https://github.com/Shasank-Bommineni/Darsi)"


def bbox(half_km: float) -> tuple[float, float, float, float]:
    dlat = (half_km * 1000.0) / 111320.0
    dlon = (half_km * 1000.0) / (111320.0 * math.cos(math.radians(ANCHOR_LAT)))
    return (ANCHOR_LAT - dlat, ANCHOR_LON - dlon, ANCHOR_LAT + dlat, ANCHOR_LON + dlon)


def build_query(b: tuple[float, float, float, float]) -> str:
    s, w, n, e = b
    box = f"{s:.6f},{w:.6f},{n:.6f},{e:.6f}"
    # A complete extract of the window: we want roads, buildings, landuse,
    # water, power infrastructure, barriers, every amenity/shop/POI node and
    # the named places.  "out geom" inlines way geometry so the downstream
    # builder needs no node resolution pass.
    return f"""
[out:json][timeout:900];
(
  nwr["highway"]({box});
  nwr["building"]({box});
  nwr["building:part"]({box});
  nwr["landuse"]({box});
  nwr["natural"]({box});
  nwr["waterway"]({box});
  nwr["water"]({box});
  nwr["leisure"]({box});
  nwr["amenity"]({box});
  nwr["shop"]({box});
  nwr["office"]({box});
  nwr["craft"]({box});
  nwr["tourism"]({box});
  nwr["historic"]({box});
  nwr["man_made"]({box});
  nwr["power"]({box});
  nwr["barrier"]({box});
  nwr["railway"]({box});
  nwr["place"]({box});
  nwr["boundary"="administrative"]["admin_level"~"^(8|9|10)$"]({box});
  nwr["traffic_calming"]({box});
  nwr["highway"="street_lamp"]({box});
  nwr["crossing"]({box});
  nwr["religion"]({box});
  nwr["healthcare"]({box});
  nwr["emergency"]({box});
);
out geom qt;
"""


def fetch(query: str, retries: int = 3) -> dict:
    last_err: Exception | None = None
    for attempt in range(retries):
        for url in ENDPOINTS:
            try:
                print(f"  -> {url} (attempt {attempt + 1})", flush=True)
                req = urllib.request.Request(
                    url,
                    data=query.encode("utf-8"),
                    headers={"User-Agent": USER_AGENT, "Content-Type": "text/plain; charset=utf-8"},
                )
                with urllib.request.urlopen(req, timeout=900) as resp:
                    payload = resp.read()
                data = json.loads(payload)
                if "elements" in data:
                    print(f"     ok: {len(data['elements'])} elements, {len(payload)/1e6:.2f} MB", flush=True)
                    return data
                last_err = RuntimeError("no elements key")
            except Exception as exc:  # noqa: BLE001 - we genuinely want to try the next mirror
                last_err = exc
                print(f"     failed: {exc}", flush=True)
                time.sleep(5)
        time.sleep(20)
    raise SystemExit(f"every Overpass endpoint failed: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="data/osm/darsi_osm.json")
    ap.add_argument("--half-km", type=float, default=4.2, help="half-width of the square window in km")
    args = ap.parse_args()

    b = bbox(args.half_km)
    print(f"Darsi window: south={b[0]:.6f} west={b[1]:.6f} north={b[2]:.6f} east={b[3]:.6f}")
    data = fetch(build_query(b))

    data["_darsi"] = {
        "anchor": {"lat": ANCHOR_LAT, "lon": ANCHOR_LON},
        "bbox": {"south": b[0], "west": b[1], "north": b[2], "east": b[3]},
        "half_km": args.half_km,
        "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "license": "ODbL 1.0",
        "attribution": "(c) OpenStreetMap contributors",
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {out} ({out.stat().st_size/1e6:.2f} MB, {len(data['elements'])} elements)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
