#!/usr/bin/env python3
"""Render data/darsi_world.json to a plain SVG so the imported geometry can be eyeballed
against openstreetmap.org without opening the game. Stdlib only."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROAD_STYLE = {
    "highway": ("#f6a623", 7.0),
    "arterial": ("#f8d26a", 5.5),
    "collector": ("#ffffff", 4.0),
    "neighbourhood": ("#e8e8e8", 3.0),
    "lane": ("#d8d8d8", 2.0),
    "track": ("#c7b8a1", 1.6),
    "path": ("#b0a089", 1.0),
}


def pairs(flat: list[float]) -> list[tuple[float, float]]:
    return [(flat[i], flat[i + 1]) for i in range(0, len(flat) - 1, 2)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path("data/darsi_world.json"))
    parser.add_argument("--output", type=Path, default=Path("docs/darsi_map_preview.svg"))
    parser.add_argument("--size", type=int, default=1600)
    args = parser.parse_args()

    world = json.loads(args.input.read_text(encoding="utf-8"))
    hx = float(world["world"]["half_extent_x"])
    hy = float(world["world"]["half_extent_y"])
    size = args.size
    scale = size / (2 * hx)

    def sx(x: float) -> float:
        return (x + hx) * scale

    def sy(y: float) -> float:
        return (hy - y) * (size / (2 * hy))

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">',
        f'<rect width="{size}" height="{size}" fill="#efeae2"/>',
    ]

    for area in world.get("green", []):
        pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in pairs(area["outline"]))
        out.append(f'<polygon points="{pts}" fill="#d7e8c4" stroke="none"/>')
    for body in world.get("water", []):
        if "outline" in body:
            pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in pairs(body["outline"]))
            out.append(f'<polygon points="{pts}" fill="#9fcfe8" stroke="none"/>')
        elif "line" in body:
            pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in pairs(body["line"]))
            out.append(f'<polyline points="{pts}" fill="none" stroke="#9fcfe8" stroke-width="2.5"/>')

    for road in sorted(world.get("roads", []), key=lambda r: ROAD_STYLE.get(r["class"], ("", 1))[1]):
        colour, width = ROAD_STYLE.get(road["class"], ("#cccccc", 1.0))
        pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in pairs(road["points"]))
        out.append(
            f'<polyline points="{pts}" fill="none" stroke="{colour}" stroke-width="{width}" '
            'stroke-linecap="round" stroke-linejoin="round"/>'
        )

    for building in world.get("buildings", []):
        pts = " ".join(f"{sx(x):.1f},{sy(y):.1f}" for x, y in pairs(building["outline"]))
        out.append(f'<polygon points="{pts}" fill="#c4b6a6" stroke="#a79584" stroke-width="0.4"/>')

    for poi in world.get("pois", []):
        out.append(f'<circle cx="{sx(poi["x"]):.1f}" cy="{sy(poi["y"]):.1f}" r="3" fill="#d1495b"/>')

    stats = world.get("stats", {})
    label = (
        f'Darsi, Prakasam, Andhra Pradesh 523247 - OpenStreetMap (ODbL) - '
        f'{stats.get("roads", 0)} road segments, {stats.get("buildings", 0)} buildings'
    )
    out.append(f'<text x="16" y="{size - 16}" font-family="sans-serif" font-size="20" fill="#333">{label}</text>')
    out.append("</svg>")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
