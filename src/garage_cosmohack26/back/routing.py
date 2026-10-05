"""Shortest-path routing over a snapshot graph.

Design notes
------------
* `optimal_route(snapshot, src, dst)` — strict shortest path.
* `diagnose_route(snapshot, src, dst, scen)` — same path plus a reason when it
  fails, and a *relaxed* fallback that retries with:
    - lower `min_elevation_deg` (so a satellite just above the horizon counts)
    - wider `isl_range_km` (so chained satellites can bridge a wide gap)
  The fallback returns a valid path when one exists under those looser
  constraints, and reports which constraint had to be relaxed.
"""
from __future__ import annotations

import heapq
import math
from typing import Iterable, Optional

import numpy as np

from geometry import R, ground_position  # reuse constants


# --------------------------------------------------------------- graph helpers

def build_graph(edges: Iterable[list]) -> dict[str, list[tuple[str, float]]]:
    g: dict[str, list[tuple[str, float]]] = {}
    for a, b, w in edges:
        g.setdefault(a, []).append((b, float(w)))
        g.setdefault(b, []).append((a, float(w)))
    return g


def dijkstra(graph, src: str, dst: str) -> Optional[tuple[list[str], float]]:
    if src == dst:
        return ([src], 0.0)
    if src not in graph or dst not in graph:
        return None
    dist = {src: 0.0}
    prev: dict[str, str] = {}
    pq = [(0.0, src)]
    seen: set[str] = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in seen:
            continue
        seen.add(u)
        if u == dst:
            break
        for v, w in graph.get(u, ()):
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if dst not in dist:
        return None
    path, cur = [], dst
    while cur != src:
        path.append(cur)
        cur = prev[cur]
    path.append(src)
    path.reverse()
    return (path, dist[dst])


def _pack(path: list[str], total_km: float) -> dict:
    hops = len(path) - 1
    prop_ms = (total_km / 300_000.0) * 1000.0
    return {
        "path": path,
        "hops": hops,
        "total_range_km": round(total_km, 2),
        "propagation_ms": round(prop_ms, 2),
        "reachable": True,
    }


# --------------------------------------------------------------- public API

def optimal_route(snapshot: dict, gateway_id: str, client_id: str) -> dict:
    """Strict shortest path.  Returns a dict with `reachable: False` on failure
    but never raises."""
    g = build_graph(snapshot.get("edges", []))
    result = dijkstra(g, gateway_id, client_id)
    if result is None:
        return {
            "gateway": gateway_id,
            "client": client_id,
            "path": [],
            "hops": 0,
            "total_range_km": None,
            "propagation_ms": None,
            "reachable": False,
            "reason": "no path under current constraints",
        }
    path, total = result
    out = _pack(path, total)
    out["gateway"] = gateway_id
    out["client"] = client_id
    return out


# --------------------------------------------------------------- relaxed search

def _relaxed_edges(
    scen: dict,
    t_s: float,
    *,
    min_elevation_deg: float,
    isl_range_km: float,
) -> list[list]:
    """Recompute the graph with looser constraints.

    This duplicates a small part of `geometry.snapshot` so we don't have to
    modify it.  It handles active satellites only (ignores launch batches that
    haven't flown yet and outages).
    """
    from geometry import positions, ground_position  # local import to avoid cycles

    e = scen["environment"]
    d = scen["design"]

    ids, _inertial, xyz = positions(scen, t_s)

    failed = {f["satellite_id"] for f in scen.get("failures", [])
              if f["start_s"] <= t_s < f["end_s"]}
    active = np.array([
        sat["launch_batch"] <= d["launch_stage"] and sat["id"] not in failed
        for sat in d["satellites"]
    ])

    edges: list[list] = []

    # satellite ↔ satellite
    n = len(ids)
    if n >= 2:
        i_idx, j_idx = np.triu_indices(n, 1)
        delta = xyz[j_idx] - xyz[i_idx]
        dist = np.linalg.norm(delta, axis=1)
        denom = np.sum(delta * delta, axis=1)
        lam = np.clip(-np.sum(xyz[i_idx] * delta, axis=1) / np.maximum(denom, 1e-12), 0, 1)
        closest = np.linalg.norm(xyz[i_idx] + lam[:, None] * delta, axis=1)
        ok = (dist < isl_range_km) & (closest > R) & active[i_idx] & active[j_idx]
        edges.extend(
            [[ids[a], ids[b], float(dd)] for a, b, dd in zip(i_idx[ok], j_idx[ok], dist[ok])]
        )

    # ground ↔ satellite
    for g in scen.get("ground_sites", []):
        gp = ground_position(g)
        dif = xyz - gp
        dl = np.linalg.norm(dif, axis=1)
        sin_el = np.clip(dif @ (gp / R) / np.maximum(dl, 1e-9), -1.0, 1.0)
        el = np.degrees(np.arcsin(sin_el))

        offline = any(
            f["gateway_id"] == g["id"] and f["start_s"] <= t_s < f["end_s"]
            for f in scen.get("gateway_outages", [])
        )
        if offline:
            continue

        vis = (el >= min_elevation_deg) & active
        for k in np.where(vis)[0]:
            edges.append([g["id"], ids[k], float(dl[k])])
    return edges


def diagnose_route(
    snapshot: dict,
    scen: dict,
    gateway_id: str,
    client_id: str,
    *,
    floor_elevation_deg: float = -5.0,
    isl_multiplier: float = 3.0,
) -> dict:
    """Strict first, then progressively relax.  Always returns a dict.

    The response includes:
      * `reachable`     — True if *any* path was found
      * `strict`        — True if the strict path succeeded
      * `relaxed`       — True if we had to loosen constraints
      * `reason`        — short human message when unreachable
      * `path`, `hops`, `total_range_km`, `propagation_ms` on success
    """
    # 1. strict attempt against the snapshot the simulation already built
    strict = optimal_route(snapshot, gateway_id, client_id)
    if strict["reachable"]:
        return {**strict, "strict": True, "relaxed": False}

    # 2. read the environment for our relaxed attempt
    e = scen["environment"]
    strict_min_el = float(e["min_elevation_deg"])
    strict_isl = float(e["isl_range_km"])

    # ground sites involved
    ground_by_id = {g["id"]: g for g in scen["ground_sites"]}
    if gateway_id not in ground_by_id or client_id not in ground_by_id:
        return {
            "gateway": gateway_id, "client": client_id,
            "path": [], "hops": 0,
            "total_range_km": None, "propagation_ms": None,
            "reachable": False, "strict": False, "relaxed": False,
            "reason": "unknown ground site id",
        }

    # candidate elevations, from strict down to the floor
    el_steps = sorted({strict_min_el, max(0.0, strict_min_el / 2.0), 0.0, floor_elevation_deg}, reverse=True)
    isl_steps = sorted({strict_isl, strict_isl * 1.5, strict_isl * isl_multiplier}, reverse=False)

    best: Optional[dict] = None
    used_el = strict_min_el
    used_isl = strict_isl

    for el_min in el_steps:
        for isl in isl_steps:
            # skip "relaxations" that are actually stricter than the original
            if el_min > strict_min_el or isl < strict_isl:
                continue
            edges = _relaxed_edges(scen, snapshot["t_s"], min_elevation_deg=el_min, isl_range_km=isl)
            g = build_graph(edges)
            r = dijkstra(g, gateway_id, client_id)
            if r is None:
                continue
            path, total = r
            best = _pack(path, total)
            used_el = el_min
            used_isl = isl
            break
        if best is not None:
            break

    if best is not None:
        best.update({
            "gateway": gateway_id,
            "client": client_id,
            "strict": False,
            "relaxed": True,
            "relaxed_min_elevation_deg": round(used_el, 3),
            "relaxed_isl_range_km": round(used_isl, 2),
            "reason": (
                f"widened reach: min_elev {strict_min_el}° → {round(used_el, 3)}°, "
                f"isl_range {strict_isl} → {round(used_isl, 2)} km"
            ),
        })
        return best

    # 3. still unreachable — explain why
    return {
        "gateway": gateway_id, "client": client_id,
        "path": [], "hops": 0,
        "total_range_km": None, "propagation_ms": None,
        "reachable": False, "strict": False, "relaxed": False,
        "reason": _explain_unreachable(snapshot, scen, gateway_id, client_id),
    }


def _explain_unreachable(snapshot: dict, scen: dict, gateway_id: str, client_id: str) -> str:
    """Best-effort one-line cause for the UI."""
    d = scen["design"]
    e = scen["environment"]
    t = snapshot["t_s"]

    failed = {f["satellite_id"] for f in scen.get("failures", [])
              if f["start_s"] <= t < f["end_s"]}
    active = [
        s for s in d["satellites"]
        if s["launch_batch"] <= d["launch_stage"] and s["id"] not in failed
    ]
    if not active:
        return "no active satellites (check launch_stage and failures)"

    # count edges per endpoint in the current snapshot
    edges = snapshot.get("edges", [])
    per_node: dict[str, int] = {}
    for a, b, _ in edges:
        per_node[a] = per_node.get(a, 0) + 1
        per_node[b] = per_node.get(b, 0) + 1

    if per_node.get(gateway_id, 0) == 0:
        return f"{gateway_id} has no visible satellite (raise horizon or lower min_elevation)"
    if per_node.get(client_id, 0) == 0:
        return f"{client_id} has no visible satellite (raise horizon or lower min_elevation)"

    # both endpoints have satellites, so the gap is between their neighborhoods
    if not edges:
        return "graph is empty (no ISL links formed)"
    return (
        "graph is disconnected between the two sites "
        "(raise isl_range_km or add more satellites)"
    )