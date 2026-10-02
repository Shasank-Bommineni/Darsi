#!/usr/bin/env python3
"""Download real elevation data for the Darsi window.

Primary source: AWS Open Data "Terrain Tiles" (terrarium encoding), which over
India is derived from NASA SRTM 1-arcsecond (~30 m) void-filled data.
  https://registry.opendata.aws/terrain-tiles/   (public domain / CC-BY depending on tile source)

Fallback: opentopodata.org public API (SRTM 30 m), queried on a coarse grid and
bilinearly upsampled.  The fallback is clearly recorded in the provenance block
so docs/world-accuracy.md can state which one was actually used.

Output: data/dem/darsi_dem.npz  (float32 heights in metres + geo metadata)
"""
from __future__ import annotations

import argparse
import io
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

ANCHOR_LAT = 15.7694505
ANCHOR_LON = 79.6776541

TERRARIUM_HOSTS = [
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium",
    "https://elevation-tiles-prod.s3.amazonaws.com/terrarium",
    "https://s3.us-east-1.amazonaws.com/elevation-tiles-prod/terrarium",
]

UA = {"User-Agent": "DarsiGame/0.3 (open-source game terrain build)"}


def deg2tile(lat: float, lon: float, z: int) -> tuple[float, float]:
    n = 2.0**z
    x = (lon + 180.0) / 360.0 * n
    latr = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(latr)) / math.pi) / 2.0 * n
    return x, y


def tile2deg(x: float, y: float, z: int) -> tuple[float, float]:
    n = 2.0**z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_terrarium(south, west, north, east, zoom) -> tuple[np.ndarray, dict] | None:
    from PIL import Image  # noqa: PLC0415

    x0f, y0f = deg2tile(north, west, zoom)
    x1f, y1f = deg2tile(south, east, zoom)
    x0, x1 = int(math.floor(x0f)), int(math.floor(x1f))
    y0, y1 = int(math.floor(y0f)), int(math.floor(y1f))
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    print(f"terrarium z={zoom}: {nx}x{ny} tiles ({nx*ny} requests)")
    mosaic = np.zeros((ny * 256, nx * 256), dtype=np.float32)
    host_ok = None
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            data = None
            for host in ([host_ok] if host_ok else []) + TERRARIUM_HOSTS:
                try:
                    data = get(f"{host}/{zoom}/{tx}/{ty}.png")
                    host_ok = host
                    break
                except Exception as exc:  # noqa: BLE001
                    print(f"  {host} {zoom}/{tx}/{ty} -> {exc}")
            if data is None:
                return None
            img = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"), dtype=np.float32)
            h = img[:, :, 0] * 256.0 + img[:, :, 1] + img[:, :, 2] / 256.0 - 32768.0
            mosaic[(ty - y0) * 256 : (ty - y0 + 1) * 256, (tx - x0) * 256 : (tx - x0 + 1) * 256] = h
    meta = {
        "source": "AWS Open Data Terrain Tiles (terrarium), NASA SRTM 1-arcsec over India",
        "source_url": "https://registry.opendata.aws/terrain-tiles/",
        "zoom": zoom,
        "tile_x0": x0,
        "tile_y0": y0,
        "nx": nx,
        "ny": ny,
    }
    # Geographic extent of the mosaic (web-mercator tile grid).
    n_lat, w_lon = tile2deg(x0, y0, zoom)
    s_lat, e_lon = tile2deg(x1 + 1, y1 + 1, zoom)
    meta.update({"mosaic_north": n_lat, "mosaic_west": w_lon, "mosaic_south": s_lat, "mosaic_east": e_lon})
    return mosaic, meta


def fetch_opentopo(south, west, north, east, n=96) -> tuple[np.ndarray, dict] | None:
    lats = np.linspace(north, south, n)
    lons = np.linspace(west, east, n)
    grid = np.zeros((n, n), dtype=np.float32)
    for i, la in enumerate(lats):
        chunks = [lons[k : k + 100] for k in range(0, n, 100)]
        vals: list[float] = []
        for ch in chunks:
            locs = "|".join(f"{la:.6f},{lo:.6f}" for lo in ch)
            for attempt in range(5):
                try:
                    raw = get(f"https://api.opentopodata.org/v1/srtm30m?locations={locs}", timeout=60)
                    js = json.loads(raw)
                    vals += [(r["elevation"] if r["elevation"] is not None else 0.0) for r in js["results"]]
                    break
                except Exception as exc:  # noqa: BLE001
                    print(f"  opentopo row {i} attempt {attempt}: {exc}")
                    time.sleep(3)
            else:
                return None
            time.sleep(1.1)
        grid[i, :] = vals
        if i % 10 == 0:
            print(f"  opentopo row {i}/{n}")
    return grid, {
        "source": "opentopodata.org public API, dataset srtm30m (NASA SRTM 1-arcsec)",
        "source_url": "https://www.opentopodata.org/datasets/srtm/",
        "grid": n,
        "mosaic_north": north,
        "mosaic_west": west,
        "mosaic_south": south,
        "mosaic_east": east,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", default="data/dem/darsi_dem.npz")
    ap.add_argument("--half-km", type=float, default=5.2, help="half-width in km (a margin wider than the OSM window)")
    ap.add_argument("--zoom", type=int, default=13)
    args = ap.parse_args()

    dlat = (args.half_km * 1000.0) / 111320.0
    dlon = (args.half_km * 1000.0) / (111320.0 * math.cos(math.radians(ANCHOR_LAT)))
    south, north = ANCHOR_LAT - dlat, ANCHOR_LAT + dlat
    west, east = ANCHOR_LON - dlon, ANCHOR_LON + dlon
    print(f"DEM window: {south:.5f},{west:.5f} .. {north:.5f},{east:.5f}")

    res = None
    try:
        res = fetch_terrarium(south, west, north, east, args.zoom)
    except Exception as exc:  # noqa: BLE001
        print(f"terrarium failed outright: {exc}")
    if res is None:
        print("falling back to opentopodata")
        res = fetch_opentopo(south, west, north, east)
    if res is None:
        raise SystemExit("no elevation source reachable")

    grid, meta = res
    meta.update(
        {
            "anchor": {"lat": ANCHOR_LAT, "lon": ANCHOR_LON},
            "request_bbox": {"south": south, "west": west, "north": north, "east": east},
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "units": "metres above sea level",
            "note": "row 0 is the NORTH edge; column 0 is the WEST edge",
        }
    )
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, heights=grid.astype(np.float32), meta=json.dumps(meta))
    print(
        f"wrote {out} ({out.stat().st_size/1e6:.2f} MB) grid={grid.shape} "
        f"min={float(grid.min()):.1f} max={float(grid.max()):.1f} mean={float(grid.mean()):.1f}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
