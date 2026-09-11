"""Effectiveness metrics over the full horizon."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import threading
from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np

import geometry
from routing import build_graph, dijkstra, _relaxed_edges


# --------------------------------------------------------------- cache

_CACHE_LOCK = threading.Lock()
_ANALYSIS_CACHE: dict[str, "HorizonReport"] = {}
_MAX_CACHE = 32


def _scenario_key(scen: dict) -> str:
    """Stable hash of everything that affects analysis."""
    payload = {
        "env": scen.get("environment", {}),
        "design": scen.get("design", {}),
        "ground_sites": scen.get("ground_sites", []),
        "failures": scen.get("failures", []),
        "gateway_outages": scen.get("gateway_outages", []),
    }
    raw = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _cache_get(key: str) -> Optional["HorizonReport"]:
    with _CACHE_LOCK:
        return _ANALYSIS_CACHE.get(key)


def _cache_put(key: str, rep: "HorizonReport") -> None:
    with _CACHE_LOCK:
        if len(_ANALYSIS_CACHE) >= _MAX_CACHE:
            # drop oldest by insertion order
            for k in list(_ANALYSIS_CACHE.keys())[: _MAX_CACHE // 2]:
                _ANALYSIS_CACHE.pop(k, None)
        _ANALYSIS_CACHE[key] = rep


def clear_cache() -> None:
    with _CACHE_LOCK:
        _ANALYSIS_CACHE.clear()


# --------------------------------------------------------------- dataclasses

@dataclass
class Gap:
    start_s: float
    end_s: float
    duration_s: float

@dataclass
class ClientReport:
    client_id: str
    coverage: float = 0.0
    reachable_steps: int = 0
    total_steps: int = 0
    mean_hops: Optional[float] = None
    max_hops: Optional[int] = None
    mean_delay_ms: Optional[float] = None
    max_delay_ms: Optional[float] = None
    gaps: list[Gap] = field(default_factory=list)
    max_gap_s: float = 0.0
    cause_breakdown: dict[str, int] = field(default_factory=dict)
    satellites_used: dict[str, int] = field(default_factory=dict)

@dataclass
class SatelliteImpact:
    satellite_id: str
    coverage_delta: float
    max_gap_delta_s: float
    clients_hit: list[str] = field(default_factory=list)

@dataclass
class HorizonReport:
    horizon_s: int
    step_s: int
    n_steps: int
    per_client: list[ClientReport]
    gateway_ids: list[str]
    client_ids: list[str]
    mean_coverage: float
    clients_below_target: list[str]
    satellites_used: dict[str, int]
    target: float


# --------------------------------------------------------------- helpers

def _gateways_offline(scen: dict, t: float) -> set[str]:
    return {
        g["gateway_id"] for g in scen.get("gateway_outages", [])
        if g["start_s"] <= t < g["end_s"]
    }


def _route_with_reason(snap, scen, gateway_id, client_id):
    g = build_graph(snap.get("edges", []))
    r = dijkstra(g, gateway_id, client_id)
    if r is not None:
        path, total = r
        return {
            "reachable": True, "strict": True, "path": path,
            "hops": len(path) - 1, "range_km": total,
            "delay_ms": (total / 300_000.0) * 1000.0, "reason": None,
        }

    e = scen["environment"]
    el_steps = sorted({float(e["min_elevation_deg"]),
                       max(0.0, float(e["min_elevation_deg"]) / 2.0),
                       0.0, -5.0}, reverse=True)
    isl_steps = sorted({float(e["isl_range_km"]),
                        float(e["isl_range_km"]) * 1.5,
                        float(e["isl_range_km"]) * 3.0})
    for el in el_steps:
        for isl in isl_steps:
            if el > e["min_elevation_deg"] or isl < e["isl_range_km"]:
                continue
            edges = _relaxed_edges(scen, snap["t_s"], min_elevation_deg=el, isl_range_km=isl)
            r = dijkstra(build_graph(edges), gateway_id, client_id)
            if r is not None:
                path, total = r
                return {
                    "reachable": True, "strict": False, "path": path,
                    "hops": len(path) - 1, "range_km": total,
                    "delay_ms": (total / 300_000.0) * 1000.0, "reason": None,
                }
    return {
        "reachable": False, "strict": False, "path": [],
        "hops": 0, "range_km": None, "delay_ms": None,
        "reason": _cause_of_failure(snap, scen, gateway_id, client_id),
    }


def _cause_of_failure(snap, scen, gateway_id, client_id):
    t = snap["t_s"]
    if gateway_id in _gateways_offline(scen, t):
        return "gateway_offline"
    edges = snap.get("edges", [])
    per_node: dict[str, int] = {}
    for a, b, _ in edges:
        per_node[a] = per_node.get(a, 0) + 1
        per_node[b] = per_node.get(b, 0) + 1
    if per_node.get(client_id, 0) == 0:
        return "no_visible_satellite"
    if per_node.get(gateway_id, 0) == 0:
        return "no_gateway_contact"
    return "isl_break"


# --------------------------------------------------------------- analysis

def analyze(scen, *, gateway_ids=None, client_ids=None,
            include_sat_usage=True, use_cache=True):
    key = _scenario_key(scen) if use_cache else None
    if key:
        cached = _cache_get(key)
        if cached is not None:
            return cached

    e = scen["environment"]
    horizon = int(e["horizon_s"])
    step = int(e["step_s"])
    target = float(e.get("target_availability", 0.9))

    gateways = gateway_ids or [g["id"] for g in scen["ground_sites"] if g["role"] == "gateway"]
    clients  = client_ids  or [g["id"] for g in scen["ground_sites"] if g["role"] == "client"]

    steps = list(range(0, horizon, step))
    n_steps = len(steps)

    reports = {cid: ClientReport(client_id=cid, total_steps=n_steps) for cid in clients}
    sat_usage: dict[str, int] = {}

    for t in steps:
        snap = geometry.snapshot(scen, t)
        for cid in clients:
            best = None
            for gw in gateways:
                r = _route_with_reason(snap, scen, gw, cid)
                if r["reachable"]:
                    best = (gw, r); break
                if best is None:
                    best = (gw, r)
            gw, r = best if best else (None, {"reachable": False, "reason": "no_gateway_contact"})
            rep = reports[cid]
            if r["reachable"]:
                rep.reachable_steps += 1
                rep.mean_hops = (
                    r["hops"] if rep.mean_hops is None
                    else rep.mean_hops + (r["hops"] - rep.mean_hops) / rep.reachable_steps
                )
                rep.max_hops = r["hops"] if rep.max_hops is None else max(rep.max_hops, r["hops"])
                if r["delay_ms"] is not None:
                    rep.mean_delay_ms = (
                        r["delay_ms"] if rep.mean_delay_ms is None
                        else rep.mean_delay_ms + (r["delay_ms"] - rep.mean_delay_ms) / rep.reachable_steps
                    )
                    rep.max_delay_ms = (
                        r["delay_ms"] if rep.max_delay_ms is None
                        else max(rep.max_delay_ms, r["delay_ms"])
                    )
                if include_sat_usage:
                    for sid in r["path"]:
                        sat_usage[sid] = sat_usage.get(sid, 0) + 1
            else:
                reason = r.get("reason") or "isl_break"
                rep.cause_breakdown[reason] = rep.cause_breakdown.get(reason, 0) + 1
                rep.gaps.append(Gap(t, t + step, step))

    for rep in reports.values():
        rep.coverage = rep.reachable_steps / n_steps if n_steps else 0.0
        rep.gaps = _coalesce_gaps(rep.gaps, step)
        rep.max_gap_s = max((g.duration_s for g in rep.gaps), default=0.0)
        rep.satellites_used = dict(sorted(sat_usage.items(), key=lambda kv: -kv[1])[:20])

    per_client = [reports[c] for c in clients]
    mean_cov = float(np.mean([r.coverage for r in per_client])) if per_client else 0.0
    below = [r.client_id for r in per_client if r.coverage < target]

    out = HorizonReport(
        horizon_s=horizon, step_s=step, n_steps=n_steps,
        per_client=per_client, gateway_ids=gateways, client_ids=clients,
        mean_coverage=mean_cov, clients_below_target=below,
        satellites_used=sat_usage, target=target,
    )
    if key:
        _cache_put(key, out)
    return out


def _coalesce_gaps(gaps, step):
    if not gaps:
        return []
    gaps = sorted(gaps, key=lambda g: g.start_s)
    out = [Gap(gaps[0].start_s, gaps[0].end_s, gaps[0].duration_s)]
    for g in gaps[1:]:
        last = out[-1]
        if abs(g.start_s - last.end_s) < 1e-6:
            last.end_s = g.end_s
            last.duration_s = last.end_s - last.start_s
        else:
            out.append(Gap(g.start_s, g.end_s, g.duration_s))
    return out


# --------------------------------------------------------------- vulnerability

def vulnerability_scan(scen, *, top_n: int = 12):
    baseline = analyze(scen)
    base_by_client = {r.client_id: r for r in baseline.per_client}

    active = [
        s["id"] for s in scen["design"]["satellites"]
        if s["launch_batch"] <= scen["design"]["launch_stage"]
    ]
    horizon = int(scen["environment"]["horizon_s"])

    impacts: list[SatelliteImpact] = []
    for sid in active:
        test = copy.deepcopy(scen)
        test.setdefault("failures", []).append({
            "satellite_id": sid, "start_s": 0.0, "end_s": float(horizon),
        })
        rep = analyze(test)
        cov_delta = rep.mean_coverage - baseline.mean_coverage
        gap_delta = 0.0
        hit: list[str] = []
        for r in rep.per_client:
            b = base_by_client[r.client_id]
            gap_delta = max(gap_delta, r.max_gap_s - b.max_gap_s)
            if r.coverage < b.coverage - 1e-6:
                hit.append(r.client_id)
        impacts.append(SatelliteImpact(
            satellite_id=sid, coverage_delta=cov_delta,
            max_gap_delta_s=gap_delta, clients_hit=hit,
        ))
    impacts.sort(key=lambda i: (i.coverage_delta, -i.max_gap_delta_s))
    return impacts[:top_n]


# --------------------------------------------------------------- single-satellite

def satellite_impact(scen: dict, sid: str) -> dict:
    horizon = int(scen["environment"]["horizon_s"])
    baseline = analyze(scen)
    base_by_client = {r.client_id: r for r in baseline.per_client}

    if not any(s["id"] == sid for s in scen["design"]["satellites"]):
        return {"satellite_id": sid, "error": "unknown satellite"}

    test = copy.deepcopy(scen)
    test.setdefault("failures", []).append({
        "satellite_id": sid, "start_s": 0.0, "end_s": float(horizon),
    })
    with_fail = analyze(test)
    fail_by_client = {r.client_id: r for r in with_fail.per_client}

    per_client_deltas = []
    worst_cov = 0.0
    worst_gap = 0.0
    for cid, b in base_by_client.items():
        f = fail_by_client.get(cid)
        if f is None:
            continue
        d_cov = f.coverage - b.coverage
        d_gap = f.max_gap_s - b.max_gap_s
        worst_cov = min(worst_cov, d_cov)
        worst_gap = max(worst_gap, d_gap)
        per_client_deltas.append({
            "client_id": cid,
            "coverage_base": b.coverage,
            "coverage_failed": f.coverage,
            "coverage_delta": d_cov,
            "max_gap_base_s": b.max_gap_s,
            "max_gap_failed_s": f.max_gap_s,
            "max_gap_delta_s": d_gap,
        })

    return {
        "satellite_id": sid,
        "baseline_mean_coverage": baseline.mean_coverage,
        "failed_mean_coverage": with_fail.mean_coverage,
        "coverage_delta": with_fail.mean_coverage - baseline.mean_coverage,
        "worst_client_coverage_delta": worst_cov,
        "worst_max_gap_delta_s": worst_gap,
        "appears_on_routes": baseline.satellites_used.get(sid, 0),
        "per_client": per_client_deltas,
    }


# --------------------------------------------------------------- serialisation

def report_to_dict(rep: HorizonReport) -> dict:
    return {
        "horizon_s": rep.horizon_s,
        "step_s": rep.step_s,
        "n_steps": rep.n_steps,
        "target": rep.target,
        "mean_coverage": rep.mean_coverage,
        "clients_below_target": rep.clients_below_target,
        "gateway_ids": rep.gateway_ids,
        "client_ids": rep.client_ids,
        "satellites_used": rep.satellites_used,
        "per_client": [
            {
                "client_id": r.client_id,
                "coverage": r.coverage,
                "reachable_steps": r.reachable_steps,
                "total_steps": r.total_steps,
                "mean_hops": r.mean_hops,
                "max_hops": r.max_hops,
                "mean_delay_ms": r.mean_delay_ms,
                "max_delay_ms": r.max_delay_ms,
                "max_gap_s": r.max_gap_s,
                "gaps": [asdict(g) for g in r.gaps],
                "cause_breakdown": r.cause_breakdown,
                "satellites_used": r.satellites_used,
            }
            for r in rep.per_client
        ],
    }   