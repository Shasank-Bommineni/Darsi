"""Build a clean, routable road graph out of the raw OSM highway ways."""
from __future__ import annotations

import math
from collections import defaultdict

from .classify import ROAD_CLASSES, SURFACE_KIND, SURFACE_QUALITY, classify_road
from .geo import dist, polyline_length, resample_polyline, smooth_polyline
from .rng import hash_f


class RoadNetwork:
    def __init__(self):
        self.nodes: list[dict] = []           # {x, y, deg, kind}
        self.node_of_osm: dict[int, int] = {}
        self.edges: list[dict] = []

    def _node(self, osm_id, x, y):
        if osm_id is not None and osm_id in self.node_of_osm:
            return self.node_of_osm[osm_id]
        idx = len(self.nodes)
        self.nodes.append({"x": x, "y": y, "edges": []})
        if osm_id is not None:
            self.node_of_osm[osm_id] = idx
        return idx

    # ------------------------------------------------------------------
    def build(self, road_feats, bounds_half: float):
        # Count node usage so we can split ways at true junctions.
        usage = defaultdict(int)
        prepared = []
        for f in road_feats:
            cls = classify_road(f.tags)
            if cls is None:
                continue
            pts = list(f.pts)
            nids = list(getattr(f, "node_ids", []) or [])
            if f.closed:
                pts = pts + [pts[0]]
            if len(nids) != len(pts):
                nids = [None] * len(pts)
            if len(pts) < 2:
                continue
            prepared.append((f, cls, pts, nids))
            for nid in nids:
                if nid is not None:
                    usage[nid] += 1
            if nids and nids[0] is not None:
                usage[nids[0]] += 1
            if nids and nids[-1] is not None:
                usage[nids[-1]] += 1

        for f, cls, pts, nids in prepared:
            spec = dict(ROAD_CLASSES[cls])
            tags = f.tags
            # --- width -----------------------------------------------------
            width = spec["width"]
            lanes = spec["lanes"]
            try:
                if tags.get("width"):
                    width = max(2.2, min(16.0, float(str(tags["width"]).split()[0])))
            except ValueError:
                pass
            try:
                if tags.get("lanes"):
                    lanes = max(1, min(4, int(float(tags["lanes"]))))
                    width = max(width, lanes * 3.2)
            except ValueError:
                pass
            # --- surface / quality ----------------------------------------
            surf_tag = (tags.get("surface") or "").strip()
            surface = SURFACE_KIND.get(surf_tag, spec["surface"])
            quality = SURFACE_QUALITY.get(surf_tag, spec["base_quality"])
            if tags.get("smoothness") in ("bad", "very_bad", "horrible", "very_horrible", "impassable"):
                quality *= 0.6
            if tags.get("smoothness") in ("excellent", "good"):
                quality = min(1.0, quality * 1.15)
            oneway = tags.get("oneway") in ("yes", "1", "true")
            bridge = bool(tags.get("bridge"))
            name = tags.get("name") or tags.get("ref") or ""

            # --- split at junctions ---------------------------------------
            cut = [0]
            for i in range(1, len(pts) - 1):
                if nids[i] is not None and usage[nids[i]] >= 2:
                    cut.append(i)
            cut.append(len(pts) - 1)
            for a, b in zip(cut[:-1], cut[1:]):
                sub = pts[a : b + 1]
                if len(sub) < 2 or polyline_length(sub) < 1.0:
                    continue
                na = self._node(nids[a], sub[0][0], sub[0][1])
                nb = self._node(nids[b], sub[-1][0], sub[-1][1])
                if na == nb and polyline_length(sub) < 8.0:
                    continue
                eid = len(self.edges)
                seed = hash_f(f.osm_id, a, 7717)
                self.edges.append(
                    {
                        "id": eid,
                        "osm": f.osm_id,
                        "cls": cls,
                        "name": name,
                        "pts": sub,
                        "width": width,
                        "shoulder": spec["shoulder"],
                        "lanes": lanes,
                        "surface": surface,
                        "quality": max(0.05, min(1.0, quality * (0.86 + 0.28 * seed))),
                        "markings": spec["markings"],
                        "speed": spec["speed"],
                        "oneway": oneway,
                        "bridge": bridge,
                        "a": na,
                        "b": nb,
                        "seed": seed,
                        "tags": {k: v for k, v in tags.items() if k in ("ref", "bridge", "layer", "tunnel", "surface", "smoothness", "lit", "name:te")},
                    }
                )
                self.nodes[na]["edges"].append(eid)
                self.nodes[nb]["edges"].append(eid)

    # ------------------------------------------------------------------
    def weld(self, radius: float = 4.0):
        """Merge graph nodes that are geometrically coincident but not shared
        in OSM (very common where imported ways meet)."""
        cell = radius
        buckets = defaultdict(list)
        for i, n in enumerate(self.nodes):
            buckets[(int(n["x"] // cell), int(n["y"] // cell))].append(i)
        parent = list(range(len(self.nodes)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        def union(a, b):
            ra, rb = find(a), find(b)
            if ra != rb:
                parent[rb] = ra

        for (bx, by), ids in buckets.items():
            cand = []
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    cand += buckets.get((bx + dx, by + dy), [])
            for i in ids:
                for j in cand:
                    if j <= i:
                        continue
                    if dist((self.nodes[i]["x"], self.nodes[i]["y"]), (self.nodes[j]["x"], self.nodes[j]["y"])) <= radius:
                        union(i, j)
        remap = {}
        new_nodes = []
        for i in range(len(self.nodes)):
            r = find(i)
            if r not in remap:
                remap[r] = len(new_nodes)
                new_nodes.append({"x": self.nodes[r]["x"], "y": self.nodes[r]["y"], "edges": []})
        for e in self.edges:
            e["a"] = remap[find(e["a"])]
            e["b"] = remap[find(e["b"])]
            e["pts"][0] = (new_nodes[e["a"]]["x"], new_nodes[e["a"]]["y"])
            e["pts"][-1] = (new_nodes[e["b"]]["x"], new_nodes[e["b"]]["y"])
            new_nodes[e["a"]]["edges"].append(e["id"])
            new_nodes[e["b"]]["edges"].append(e["id"])
        self.nodes = new_nodes

    def refine(self, step: float = 7.0):
        """Resample + lightly smooth every centreline so the generated ribbons
        follow a continuous curve instead of long straight OSM chords."""
        for e in self.edges:
            pts = resample_polyline(e["pts"], step)
            if len(pts) > 3:
                pts = smooth_polyline(pts, passes=2, weight=0.35)
            e["pts"] = pts
            e["length"] = polyline_length(pts)

    def drop_outside(self, half: float):
        keep = []
        for e in self.edges:
            inside = [p for p in e["pts"] if abs(p[0]) <= half and abs(p[1]) <= half]
            if len(inside) < 2:
                continue
            keep.append(e)
        self.edges = keep
        # Re-index
        for i, e in enumerate(self.edges):
            e["id"] = i
        for n in self.nodes:
            n["edges"] = []
        for e in self.edges:
            self.nodes[e["a"]]["edges"].append(e["id"])
            self.nodes[e["b"]]["edges"].append(e["id"])

    def largest_component(self):
        """Return the set of edge ids in the biggest connected component."""
        adj = defaultdict(list)
        for e in self.edges:
            adj[e["a"]].append((e["b"], e["id"]))
            adj[e["b"]].append((e["a"], e["id"]))
        seen = set()
        best: set[int] = set()
        for start in list(adj.keys()):
            if start in seen:
                continue
            stack = [start]
            comp_nodes = set()
            comp_edges: set[int] = set()
            seen.add(start)
            while stack:
                n = stack.pop()
                comp_nodes.add(n)
                for m, eid in adj[n]:
                    comp_edges.add(eid)
                    if m not in seen:
                        seen.add(m)
                        stack.append(m)
            if len(comp_edges) > len(best):
                best = comp_edges
        return best
