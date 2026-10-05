"""FastAPI application: REST for configs and analytics, WebSockets for live sim."""
from __future__ import annotations

import asyncio
import contextlib
import csv
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from fastapi import (
    FastAPI, HTTPException, WebSocket, WebSocketDisconnect,
    UploadFile, File, Form, Query,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

import geometry
from routing import optimal_route, diagnose_route
from scenario_store import (
    ScenarioStore, list_configs, load_config, save_config, delete_config,
    EXAMPLE_PATH,
)
from schemas import (
    ScenarioModel, ScenarioPatch, ScenarioAck,
    TelemetryFrame, RoutesFrame,
    ConfigSummary,
)
import analytics

# NEW: bring in the metrics / optimizer module
import metrics as metrics_mod


# --------------------------------------------------------------- limits
MAX_SATELLITES_PER_SCENARIO = 500      # hard cap on any uploaded/created scenario
MAX_SATELLITES_FOR_OPTIMAL  = 100       # hard cap on any single stage of /api/calculate_optimal
MAX_ITERATIONS_FOR_OPTIMAL  = 200      # hard cap on iterations per stage


# --------------------------------------------------------------- paths
BACK_DIR = Path(__file__).resolve().parent
FRONT_DIR = BACK_DIR.parent / "front"
FRONT_DIST_DIR = FRONT_DIR / "dist"
INDEX_HTML = FRONT_DIST_DIR / "index.html"


# --------------------------------------------------------------- app
app = FastAPI(
    title="Constellation Simulator",
    version="0.6.0",
    description=(
        "Constellation simulator with effectiveness analytics.\n\n"
        "**HTTP**: configs, snapshots, analytics.\n"
        "**WebSockets**: live telemetry, routes, control."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

store = ScenarioStore()
SUN_ECI = [1.0, 0.0, 0.0]

# One worker per CPU is enough — analytics is CPU-bound and we want the loop free.
_EXECUTOR = ThreadPoolExecutor(max_workers=4)


async def _run_blocking(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_EXECUTOR, lambda: fn(*args, **kwargs))


# --------------------------------------------------------------- limit helpers
def _satellite_count(scenario: dict) -> int:
    """Return the number of satellites declared in a scenario."""
    try:
        return len(scenario["design"]["satellites"])
    except (KeyError, TypeError):
        return 0


def _enforce_scenario_limit(scenario: dict, *, source: str = "scenario") -> None:
    """Reject scenarios with more than MAX_SATELLITES_PER_SCENARIO satellites."""
    n = _satellite_count(scenario)
    if n > MAX_SATELLITES_PER_SCENARIO:
        raise HTTPException(
            400,
            f"{source} declares {n} satellites, "
            f"which exceeds the limit of {MAX_SATELLITES_PER_SCENARIO}",
        )


# ================================================================
#  HTTP: config library
# ================================================================

@app.get("/api/configs", response_model=list[ConfigSummary], tags=["configs"])
async def api_list_configs():
    return list_configs()


@app.get("/api/configs/{config_id}", tags=["configs"])
async def api_get_config(config_id: str):
    try:
        return load_config(config_id)
    except FileNotFoundError:
        raise HTTPException(404, f"config {config_id!r} not found")


@app.post("/api/configs", tags=["configs"])
async def api_save_active(config_id: str, title: str = ""):
    if not config_id:
        raise HTTPException(400, "config_id is required")
    # The active scenario must also respect the cap.
    _enforce_scenario_limit(store.snapshot_sync(), source="active scenario")
    doc = await store.save_as(config_id, title or config_id)
    return {"saved": config_id, "meta": store.meta()}


@app.post("/api/configs/upload", tags=["configs"])
async def api_upload_config(doc: ScenarioModel, as_id: Optional[str] = None):
    target = as_id or doc.meta.id
    if not target:
        raise HTTPException(400, "config id missing")

    payload = doc.model_dump()
    _enforce_scenario_limit(payload, source=f"config {target!r}")

    payload["meta"]["id"] = target
    save_config(payload)
    return {"saved": target}


@app.delete("/api/configs/{config_id}", tags=["configs"])
async def api_delete_config(config_id: str):
    if EXAMPLE_PATH.exists():
        ex = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        if ex["meta"]["id"] == config_id:
            raise HTTPException(400, "cannot delete the shipped example")
    if not delete_config(config_id):
        raise HTTPException(404, f"config {config_id!r} not found")
    return {"deleted": config_id}


# ================================================================
#  HTTP: active scenario
# ================================================================

@app.get("/api/scenario", tags=["scenario"])
async def api_get_scenario():
    return {"meta": store.meta(), "scenario": await store.snapshot()}


@app.post("/api/scenario/load/{config_id}", tags=["scenario"])
async def api_load(config_id: str):
    try:
        await store.load(config_id)
    except FileNotFoundError:
        raise HTTPException(404, f"config {config_id!r} not found")
    except Exception as exc:
        raise HTTPException(400, f"invalid config: {exc}")
    # A loaded config must respect the cap too.
    _enforce_scenario_limit(store.snapshot_sync(), source=f"config {config_id!r}")
    return {"loaded": config_id, "meta": store.meta()}


@app.post("/api/scenario/new", tags=["scenario"])
async def api_new(title: str = "Untitled"):
    await store.new_empty(title)
    return {"meta": store.meta()}


@app.put("/api/scenario", tags=["scenario"])
async def api_replace(doc: ScenarioModel):
    payload = doc.model_dump()
    _enforce_scenario_limit(payload, source="replacement scenario")
    await store.set_scenario(payload)
    return {"meta": store.meta()}


@app.post("/api/scenario/patch", response_model=ScenarioAck, tags=["scenario"])
async def api_patch(patch: ScenarioPatch):
    # Apply to a copy first so we can validate the post-patch size without
    # mutating the live scenario.
    current = store.snapshot_sync()
    candidate = json.loads(json.dumps(current))  # cheap deep copy via JSON
    try:
        _apply_patch_to_dict(candidate, patch.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    _enforce_scenario_limit(candidate, source="patched scenario")

    try:
        applied = await store.apply_patch(patch.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ScenarioAck(applied=applied)


def _apply_patch_to_dict(scenario: dict, patch: dict) -> None:
    """
    Mirror of ScenarioStore.apply_patch, applied to a plain dict.
    Used only for size validation before committing the patch.
    Raises ValueError if the patch is structurally invalid.
    """
    design = scenario.setdefault("design", {})
    env = scenario.setdefault("environment", {})

    for key, value in (patch.get("environment") or {}).items():
        env[key] = value

    for key, value in (patch.get("design") or {}).items():
        if key == "planes" and value is not None:
            # Replace the plane list wholesale.
            design["planes"] = value
        elif key == "satellites" and value is not None:
            design["satellites"] = value
        else:
            design[key] = value

    for key in ("ground_sites", "failures", "gateway_outages"):
        if key in patch and patch[key] is not None:
            scenario[key] = patch[key]


# ================================================================
#  HTTP: snapshots
# ================================================================

@app.get("/api/telemetry", response_model=TelemetryFrame, tags=["snapshot"])
async def api_telemetry():
    scen = store.snapshot_sync()
    snap = geometry.snapshot(scen, store.t_s)
    sun = geometry.sunlight(scen, store.t_s, SUN_ECI) if snap["satellites"] else {}
    return TelemetryFrame(
        t_s=snap["t_s"], horizon_s=scen["environment"]["horizon_s"],
        step_s=scen["environment"]["step_s"],
        satellites=[{**s, "sunlit": sun.get(s["id"], True)} for s in snap["satellites"]],
        edges=snap["edges"],
    )


@app.get("/api/routes", response_model=RoutesFrame, tags=["snapshot"])
async def api_routes():
    scen = store.snapshot_sync()
    snap = geometry.snapshot(scen, store.t_s)
    gateways = [g["id"] for g in scen["ground_sites"] if g["role"] == "gateway"]
    clients = [g["id"] for g in scen["ground_sites"] if g["role"] == "client"]
    routes = []
    for gw in gateways:
        for cl in clients:
            r = diagnose_route(snap, scen, gw, cl)
            r["t_s"] = snap["t_s"]
            routes.append(r)
    return RoutesFrame(t_s=snap["t_s"], routes=routes)


# ================================================================
#  HTTP: analytics
# ================================================================

def _analytics_scenario(config_id: Optional[str]) -> dict:
    if config_id:
        try:
            return load_config(config_id)
        except FileNotFoundError:
            raise HTTPException(404, f"config {config_id!r} not found")
    return store.snapshot_sync()


@app.get("/api/analytics/coverage", tags=["analytics"])
async def api_coverage(config_id: Optional[str] = None):
    scen = _analytics_scenario(config_id)
    rep = await _run_blocking(analytics.analyze, scen)
    return analytics.report_to_dict(rep)


@app.get("/api/analytics/vulnerability", tags=["analytics"])
async def api_vulnerability(config_id: Optional[str] = None, top_n: int = 12):
    scen = _analytics_scenario(config_id)
    impacts = await _run_blocking(analytics.vulnerability_scan, scen, top_n=top_n)
    return {
        "candidate_count": len([
            s for s in scen["design"]["satellites"]
            if s["launch_batch"] <= scen["design"]["launch_stage"]
        ]),
        "impacts": [
            {
                "satellite_id": i.satellite_id,
                "coverage_delta": i.coverage_delta,
                "max_gap_delta_s": i.max_gap_delta_s,
                "clients_hit": i.clients_hit,
            }
            for i in impacts
        ],
    }


@app.get("/api/analytics/satellite/{sid}", tags=["analytics"])
async def api_satellite_impact(sid: str, config_id: Optional[str] = None):
    scen = _analytics_scenario(config_id)
    result = await _run_blocking(analytics.satellite_impact, scen, sid)
    if "error" in result:
        raise HTTPException(404, result["error"])
    return result


@app.get("/api/analytics/compare", tags=["analytics"])
async def api_compare(a: str, b: str):
    try:
        scen_a = load_config(a)
        scen_b = load_config(b)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))

    rep_a_obj, rep_b_obj = await asyncio.gather(
        _run_blocking(analytics.analyze, scen_a),
        _run_blocking(analytics.analyze, scen_b),
    )
    rep_a = analytics.report_to_dict(rep_a_obj)
    rep_b = analytics.report_to_dict(rep_b_obj)

    ma = {r["client_id"]: r for r in rep_a["per_client"]}
    mb = {r["client_id"]: r for r in rep_b["per_client"]}
    all_clients = sorted(set(ma) | set(mb))
    deltas = []
    for cid in all_clients:
        ra, rb = ma.get(cid), mb.get(cid)
        deltas.append({
            "client_id": cid,
            "coverage_a": ra["coverage"] if ra else None,
            "coverage_b": rb["coverage"] if rb else None,
            "coverage_delta": (rb["coverage"] - ra["coverage"]) if ra and rb else None,
            "max_gap_a_s": ra["max_gap_s"] if ra else None,
            "max_gap_b_s": rb["max_gap_s"] if rb else None,
            "max_gap_delta_s": (rb["max_gap_s"] - ra["max_gap_s"]) if ra and rb else None,
            "mean_hops_a": ra["mean_hops"] if ra else None,
            "mean_hops_b": rb["mean_hops"] if rb else None,
            "mean_delay_a_ms": ra["mean_delay_ms"] if ra else None,
            "mean_delay_b_ms": rb["mean_delay_ms"] if rb else None,
        })
    return {
        "a": {"config_id": a, "meta": scen_a["meta"], "summary": {
            "mean_coverage": rep_a["mean_coverage"],
            "target": rep_a["target"],
            "clients_below_target": rep_a["clients_below_target"],
        }},
        "b": {"config_id": b, "meta": scen_b["meta"], "summary": {
            "mean_coverage": rep_b["mean_coverage"],
            "target": rep_b["target"],
            "clients_below_target": rep_b["clients_below_target"],
        }},
        "deltas": deltas,
    }


@app.get("/api/analytics/export", tags=["analytics"])
async def api_export(config_id: Optional[str] = None):
    scen = _analytics_scenario(config_id)
    rep = await _run_blocking(analytics.analyze, scen)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "client_id", "coverage", "reachable_steps", "total_steps",
        "mean_hops", "max_hops", "mean_delay_ms", "max_delay_ms",
        "max_gap_s", "n_gaps",
        "cause_no_visible_satellite", "cause_isl_break",
        "cause_no_gateway_contact", "cause_gateway_offline",
    ])
    for r in rep.per_client:
        cb = r.cause_breakdown
        w.writerow([
            r.client_id, f"{r.coverage:.4f}", r.reachable_steps, r.total_steps,
            f"{r.mean_hops:.3f}" if r.mean_hops is not None else "",
            r.max_hops if r.max_hops is not None else "",
            f"{r.mean_delay_ms:.3f}" if r.mean_delay_ms is not None else "",
            f"{r.max_delay_ms:.3f}" if r.max_delay_ms is not None else "",
            f"{r.max_gap_s:.0f}", len(r.gaps),
            cb.get("no_visible_satellite", 0),
            cb.get("isl_break", 0),
            cb.get("no_gateway_contact", 0),
            cb.get("gateway_offline", 0),
        ])
    buf.seek(0)
    filename = f"coverage_{config_id or 'active'}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/analytics/export.json", tags=["analytics"])
async def api_export_json(config_id: Optional[str] = None):
    scen = _analytics_scenario(config_id)
    rep = await _run_blocking(analytics.analyze, scen)
    return analytics.report_to_dict(rep)


# ================================================================
#  HTTP: metrics  (NEW)
# ================================================================

def _parse_uploaded_json(raw: bytes) -> dict:
    try:
        return json.loads(raw.decode("utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(400, f"uploaded file is not valid UTF-8: {exc}")
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"uploaded file is not valid JSON: {exc}")


def _metrics_timestep_rows(scenario: dict):
    """
    Yield one flat dict per (t_s, client) with the per-step info.
    Used both for the JSON "timesteps" array and for the CSV.
    """
    e = scenario["environment"]
    step = e["step_s"]
    N = e["horizon_s"] // step
    clients = [g["id"] for g in scenario["ground_sites"] if g["role"] == "client"]
    gateways = [g["id"] for g in scenario["ground_sites"] if g["role"] == "gateway"]

    for k in range(N):
        t_s = k * step
        snap = geometry.snapshot(scenario, t_s)
        edges = snap["edges"]
        elev = snap["elevation_deg"]
        min_el = e["min_elevation_deg"]

        for c in clients:
            visible = any(elev[c][s] >= min_el for s in elev[c])
            path = metrics_mod.shortest_path_to_any_gateway(edges, c, gateways)
            yield {
                "t_s": t_s,
                "client_id": c,
                "visible": bool(visible),
                "has_path": path is not None,
                "path": path if path is not None else [],
                "hops": (len(path) - 1) if path is not None else None,
            }


@app.post("/api/metrics", tags=["metrics"])
async def api_metrics(
    file: UploadFile = File(..., description="cosmo-A-1.0 scenario JSON"),
    fmt: str = Query("json", pattern="^(json|csv)$"),
    include_timesteps: bool = Query(True),
):
    """
    Upload a scenario, get per-client summary metrics + optional per-timestep data.

    Query params:
      fmt               : "json" (default) or "csv"
      include_timesteps : if true (default), include the per-step rows
    """
    raw = await file.read()
    scenario = _parse_uploaded_json(raw)

    # Enforce satellite cap before doing any work.
    _enforce_scenario_limit(scenario, source=file.filename or "uploaded scenario")

    # Validate early — the same validator geometry.py uses.
    try:
        geometry.validate(scenario)
    except ValueError as exc:
        raise HTTPException(400, f"invalid scenario: {exc}")

    summary = await _run_blocking(metrics_mod.client_metrics, scenario)

    if fmt == "json":
        out = {"summary": summary}
        if include_timesteps:
            out["timesteps"] = list(_metrics_timestep_rows(scenario))
        return out

    # ---- CSV branch ----
    buf = io.StringIO()
    w = csv.writer(buf)

    if include_timesteps:
        w.writerow(["section", "t_s", "client_id", "visible", "has_path",
                    "hops", "path"])
        for row in _metrics_timestep_rows(scenario):
            w.writerow([
                "timestep", row["t_s"], row["client_id"],
                int(row["visible"]), int(row["has_path"]),
                row["hops"] if row["hops"] is not None else "",
                "|".join(row["path"]),
            ])

    w.writerow([])
    w.writerow(["section", "client_id", "visibility_pct",
                "gateway_availability_pct", "max_interruption_s", "avg_hops"])
    for cid, m in summary.items():
        w.writerow([
            "summary", cid,
            f"{m['visibility_pct']:.4f}",
            f"{m['gateway_availability_pct']:.4f}",
            f"{m['max_interruption_s']:.0f}",
            f"{m['avg_hops']:.4f}" if m["avg_hops"] is not None else "",
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition":
                f'attachment; filename="metrics_{file.filename or "scenario"}.csv"'
        },
    )


# ================================================================
#  HTTP: calculate_optimal  (NEW)
# ================================================================

@app.post("/api/calculate_optimal", tags=["optimize"])
async def api_calculate_optimal(
    base_file: UploadFile = File(..., description="Base cosmo-A-1.0 scenario (environment + ground sites)"),
    satellites_per_plane: str = Form(..., description="JSON array, e.g. [8,8,8] for 3 stages of 8 sats/plane"),
    planes: int = Form(3, description="Number of orbital planes"),
    iterations: int = Form(100, description="Random-search iterations per stage"),
    seed: int = Form(0, description="RNG seed for reproducibility"),
    include_metrics: bool = Form(True, description="Include per-client metrics in each streamed stage"),
):
    """
    Stream the optimal configuration for each deployment step as it is generated.

    Response is NDJSON (application/x-ndjson), one JSON object per line:
      {"stage": 1, "n_sat": 16, "scenario": {...}, "metrics": {...}, "bounds": {...}}
      {"stage": 2, ...}
      {"stage": 3, ...}
      {"done": true, "stages": 3}
    """
    raw = await base_file.read()
    base = _parse_uploaded_json(raw)

    # Enforce scenario-wide satellite cap on the base file too.
    _enforce_scenario_limit(base, source=f"base scenario {base_file.filename!r}")

    try:
        geometry.validate(base)
    except ValueError as exc:
        raise HTTPException(400, f"invalid base scenario: {exc}")

    # Parse satellites_per_plane — accept "[8,8,8]" or "8,8,8".
    try:
        spec = json.loads(satellites_per_plane)
    except json.JSONDecodeError:
        try:
            spec = [int(x) for x in satellites_per_plane.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(400,
                "satellites_per_plane must be a JSON array or comma-separated ints")
    if not isinstance(spec, list) or not spec:
        raise HTTPException(400, "satellites_per_plane must be a non-empty list")
    try:
        spec = [int(x) for x in spec]
    except (TypeError, ValueError):
        raise HTTPException(400, "satellites_per_plane values must be integers")
    if any(x <= 0 for x in spec):
        raise HTTPException(400, "satellites_per_plane values must be positive")

    if planes <= 0:
        raise HTTPException(400, "planes must be a positive integer")

    # ---- Iteration cap ----
    if iterations <= 0:
        raise HTTPException(400, "iterations must be a positive integer")
    if iterations > MAX_ITERATIONS_FOR_OPTIMAL:
        raise HTTPException(
            400,
            f"iterations={iterations} exceeds the limit of "
            f"{MAX_ITERATIONS_FOR_OPTIMAL} per stage",
        )

    # ---- Satellite cap (per stage, cumulative) ----
    # Each stage k has planes * spec[k] satellites on orbit, but the optimizer
    # itself designs the *cumulative* total: planes * sum(spec[:k+1]).
    # Apply the cap to the cumulative count for every stage.
    cumulative = 0
    for i, per_plane in enumerate(spec, start=1):
        cumulative += per_plane * planes
        if cumulative > MAX_SATELLITES_FOR_OPTIMAL:
            raise HTTPException(
                400,
                f"stage {i} would have {cumulative} satellites "
                f"({planes} planes × {per_plane} per plane cumulative), "
                f"which exceeds the optimization limit of "
                f"{MAX_SATELLITES_FOR_OPTIMAL}",
            )

    async def stream():
        total_sats = 0
        for stage_idx, per_plane in enumerate(spec, start=1):
            total_sats += per_plane * planes

            # The metrics optimizer is CPU-bound; run it off the event loop.
            result = await _run_blocking(
                metrics_mod.optimize,
                base, total_sats, planes,
                iterations=iterations,
                seed=seed + stage_idx,
            )

            # The scenario produced by optimize() already has launch_stage=3.
            # For a deployment stage we want the satellites of *this* batch to
            # be active and the next ones inactive.  We re-tag launch_batch so
            # stage k only includes batches <= k, while the *total* count still
            # matches what the optimizer chose.
            scenario = result["best_scenario"]
            n_sats_total = len(scenario["design"]["satellites"])
            per_batch = n_sats_total / len(spec) if spec else n_sats_total
            for i, sat in enumerate(scenario["design"]["satellites"]):
                batch = min(len(spec), int(i // per_batch) + 1)
                sat["launch_batch"] = batch
            scenario["design"]["launch_stage"] = stage_idx
            scenario["meta"]["id"] = (
                f"{base['meta']['id']}_stage{stage_idx}_opt"
            )
            scenario["meta"]["title"] = (
                f"{base['meta'].get('title', base['meta']['id'])} — stage {stage_idx}"
            )

            # Re-evaluate with the stage applied (so metrics reflect this stage only).
            stage_metrics = await _run_blocking(
                metrics_mod.client_metrics, scenario
            )

            payload = {
                "stage": stage_idx,
                "n_sat": total_sats,
                "scenario": scenario,
                "bounds": result["bounds"],
                "best_score": result["best_score"],
                "met_target": all(
                    m["gateway_availability_pct"] >= 100.0 * base["environment"]["target_availability"]
                    for m in stage_metrics.values()
                ),
            }
            if include_metrics:
                payload["metrics"] = stage_metrics

            yield (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")

        yield (json.dumps(
            {"done": True, "stages": len(spec)}, ensure_ascii=False
        ) + "\n").encode("utf-8")

    return StreamingResponse(
        stream(),
        media_type="application/x-ndjson",
        headers={"X-Accel-Buffering": "no"},  # disable proxy buffering
    )


# ================================================================
#  HTTP: compare  (NEW)
# ================================================================

@app.post("/api/compare", tags=["compare"])
async def api_compare_files(
    files: list[UploadFile] = File(..., description="Two or more scenario JSONs"),
    fmt: str = Query("json", pattern="^(json|csv)$"),
):
    """
    Upload N >= 2 scenarios, get a comparison of their per-client metrics.

    Query params:
      fmt : "json" (default) or "csv"
    """
    if len(files) < 2:
        raise HTTPException(400, "at least two files are required")

    scenarios = []
    names = []
    for f in files:
        raw = await f.read()
        scen = _parse_uploaded_json(raw)
        # Cap applies to every uploaded scenario in the comparison.
        _enforce_scenario_limit(scen, source=f.filename or f"scenario_{len(scenarios)+1}")
        try:
            geometry.validate(scen)
        except ValueError as exc:
            raise HTTPException(400, f"{f.filename}: invalid scenario: {exc}")
        scenarios.append(scen)
        names.append(f.filename or f"scenario_{len(scenarios)}")

    # Evaluate all scenarios in parallel.
    metric_lists = await asyncio.gather(*[
        _run_blocking(metrics_mod.client_metrics, s) for s in scenarios
    ])

    # Collect all client ids across all scenarios.
    all_clients = sorted({
        cid for m in metric_lists for cid in m.keys()
    })

    # Build a per-client, per-scenario table.
    rows = []
    for cid in all_clients:
        row = {"client_id": cid}
        for name, m in zip(names, metric_lists):
            row[name] = m.get(cid, {})
        rows.append(row)

    # Also a summary per scenario (mean availability, min availability).
    summaries = []
    for name, m in zip(names, metric_lists):
        if not m:
            summaries.append({
                "name": name, "mean_availability": None,
                "min_availability": None, "mean_visibility": None,
            })
            continue
        avails = [v["gateway_availability_pct"] for v in m.values()]
        viss = [v["visibility_pct"] for v in m.values()]
        summaries.append({
            "name": name,
            "mean_availability": sum(avails) / len(avails),
            "min_availability": min(avails),
            "mean_visibility": sum(viss) / len(viss),
        })

    # Pairwise deltas against the first scenario (baseline).
    baseline_name = names[0]
    baseline = metric_lists[0]
    pairwise = []
    for cid in all_clients:
        base_m = baseline.get(cid, {})
        for name, m in zip(names[1:], metric_lists[1:]):
            other = m.get(cid, {})
            pairwise.append({
                "client_id": cid,
                "baseline": baseline_name,
                "other": name,
                "availability_delta":
                    (other.get("gateway_availability_pct", 0)
                     - base_m.get("gateway_availability_pct", 0))
                    if other and base_m else None,
                "visibility_delta":
                    (other.get("visibility_pct", 0)
                     - base_m.get("visibility_pct", 0))
                    if other and base_m else None,
                "max_interruption_delta_s":
                    (other.get("max_interruption_s", 0)
                     - base_m.get("max_interruption_s", 0))
                    if other and base_m else None,
            })

    result = {
        "scenarios": names,
        "clients": all_clients,
        "rows": rows,
        "summaries": summaries,
        "pairwise_vs_baseline": pairwise,
    }

    if fmt == "json":
        return result

    # ---- CSV branch ----
    buf = io.StringIO()
    w = csv.writer(buf)

    # Summary block
    w.writerow(["section", "scenario", "mean_availability",
                "min_availability", "mean_visibility"])
    for s in summaries:
        w.writerow([
            "summary", s["name"],
            f"{s['mean_availability']:.4f}" if s["mean_availability"] is not None else "",
            f"{s['min_availability']:.4f}" if s["min_availability"] is not None else "",
            f"{s['mean_visibility']:.4f}" if s["mean_visibility"] is not None else "",
        ])
    w.writerow([])

    # Per-client block
    header = ["section", "client_id"]
    for name in names:
        header += [f"{name}.visibility_pct", f"{name}.availability_pct",
                   f"{name}.max_interruption_s", f"{name}.avg_hops"]
    w.writerow(header)
    for cid in all_clients:
        row = ["client", cid]
        for m in metric_lists:
            v = m.get(cid, {})
            row += [
                f"{v.get('visibility_pct', '')}",
                f"{v.get('gateway_availability_pct', '')}",
                f"{v.get('max_interruption_s', '')}",
                f"{v.get('avg_hops', '') if v.get('avg_hops') is not None else ''}",
            ]
        w.writerow(row)
    w.writerow([])

    # Pairwise block
    w.writerow(["section", "client_id", "baseline", "other",
                "availability_delta", "visibility_delta",
                "max_interruption_delta_s"])
    for p in pairwise:
        w.writerow([
            "pairwise", p["client_id"], p["baseline"], p["other"],
            f"{p['availability_delta']:.4f}" if p["availability_delta"] is not None else "",
            f"{p['visibility_delta']:.4f}" if p["visibility_delta"] is not None else "",
            f"{p['max_interruption_delta_s']:.0f}" if p["max_interruption_delta_s"] is not None else "",
        ])

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="comparison.csv"'},
    )


# ================================================================
#  React frontend
# ================================================================

if (FRONT_DIST_DIR / "assets").is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONT_DIST_DIR / "assets"),
        name="frontend-assets",
    )


@app.get("/{path:path}", include_in_schema=False)
async def frontend(path: str):
    if INDEX_HTML.exists():
        requested = (FRONT_DIST_DIR / path).resolve()
        if requested.is_relative_to(FRONT_DIST_DIR.resolve()) and requested.is_file():
            return FileResponse(requested)
        return FileResponse(INDEX_HTML)
    return HTMLResponse(
        "<h1>Constellation Simulator</h1>"
        f"<p>Build the React frontend at <code>{INDEX_HTML}</code>.</p>"
    )


# ================================================================
#  WebSockets
# ================================================================

async def simulation_loop():
    telemetry_subs: set[asyncio.Queue] = set()
    route_subs: set[asyncio.Queue] = set()
    event_subs: set[asyncio.Queue] = set()

    app.state.telemetry_subs = telemetry_subs
    app.state.route_subs = route_subs
    app.state.event_subs = event_subs

    prev_edges: list = []
    last_tele = 0.0
    last_route = 0.0
    last_clock = time.monotonic()

    while True:
        try:
            now = time.monotonic()
            wall_dt = now - last_clock
            last_clock = now

            scen = store.snapshot_sync()
            horizon = scen["environment"]["horizon_s"]

            if not scen["design"]["satellites"] and not scen["ground_sites"]:
                await asyncio.sleep(0.1)
                continue

            if last_route:
                store.t_s = (store.t_s + wall_dt * store.playback) % horizon

            snap = None

            tele_interval = 1.0 / max(store.tele_hz, 0.1)
            if now - last_tele >= tele_interval:
                snap = geometry.snapshot(scen, store.t_s)
                sun = geometry.sunlight(scen, store.t_s, SUN_ECI) if snap["satellites"] else {}
                payload = {
                    "type": "telemetry",
                    "t_s": snap["t_s"],
                    "horizon_s": horizon,
                    "step_s": scen["environment"]["step_s"],
                    "satellites": [
                        {**sat, "sunlit": sun.get(sat["id"], True)}
                        for sat in snap["satellites"]
                    ],
                    "edges": snap["edges"],
                }
                for q in list(telemetry_subs):
                    _put(q, payload)
                last_tele = now

            route_interval = 1.0 / max(store.route_hz, 0.1)
            if now - last_route >= route_interval:
                if snap is None:
                    snap = geometry.snapshot(scen, store.t_s)
                gateways = [g["id"] for g in scen["ground_sites"] if g["role"] == "gateway"]
                clients = [g["id"] for g in scen["ground_sites"] if g["role"] == "client"]
                routes = []
                for gw in gateways:
                    for cl in clients:
                        r = diagnose_route(snap, scen, gw, cl)
                        r["t_s"] = snap["t_s"]
                        routes.append(r)
                payload = {"type": "routes", "t_s": snap["t_s"], "routes": routes}
                for q in list(route_subs):
                    _put(q, payload)

                events = _diff_edges(prev_edges, snap["edges"], snap["t_s"])
                if events:
                    ev = {"type": "events", "t_s": snap["t_s"], "events": events}
                    for q in list(event_subs):
                        _put(q, ev)
                prev_edges = snap["edges"]
                last_route = now

            await asyncio.sleep(0.01)
        except Exception:
            await asyncio.sleep(0.5)


def _put(q: asyncio.Queue, item: dict) -> None:
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        with contextlib.suppress(asyncio.QueueEmpty):
            q.get_nowait()
        with contextlib.suppress(asyncio.QueueFull):
            q.put_nowait(item)


def _diff_edges(old: list, new: list, t_s: float) -> list[dict]:
    old_set = {tuple(sorted((a, b))) for a, b, _ in old}
    new_set = {tuple(sorted((a, b))) for a, b, _ in new}
    events: list[dict] = []
    for a, b in new_set - old_set:
        events.append({"kind": "link_up", "a": a, "b": b, "t_s": t_s})
    for a, b in old_set - new_set:
        events.append({"kind": "link_down", "a": a, "b": b, "t_s": t_s})
    return events


@app.on_event("startup")
async def _startup():
    app.state.sim_task = asyncio.create_task(simulation_loop())


@app.on_event("shutdown")
async def _shutdown():
    app.state.sim_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await app.state.sim_task
    _EXECUTOR.shutdown(wait=False, cancel_futures=True)


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=8)
    app.state.telemetry_subs.add(q)
    try:
        await ws.send_json({"type": "telemetry_init", "meta": store.meta()})
        while True:
            await ws.send_json(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        app.state.telemetry_subs.discard(q)


@app.websocket("/ws/route")
async def ws_route(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=8)
    app.state.route_subs.add(q)
    try:
        while True:
            await ws.send_json(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        app.state.route_subs.discard(q)


@app.websocket("/ws/scenario")
async def ws_scenario(ws: WebSocket):
    await ws.accept()
    q = store.subscribe()
    try:
        await ws.send_json({"type": "scenario_ready", "meta": store.meta()})
        while True:
            recv_task = asyncio.create_task(ws.receive_json())
            pub_task = asyncio.create_task(q.get())
            done, pending = await asyncio.wait(
                {recv_task, pub_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            if recv_task in done:
                try:
                    patch = recv_task.result()
                    applied = await store.apply_patch(patch)
                    await ws.send_json({"type": "scenario_ack", "applied": applied})
                except ValueError as exc:
                    await ws.send_json({"type": "scenario_error", "error": str(exc)})
                except Exception as exc:
                    await ws.send_json({"type": "scenario_error", "error": str(exc)})
            if pub_task in done:
                await ws.send_json(pub_task.result())
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(q)


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    app.state.event_subs.add(q)
    try:
        while True:
            await ws.send_json(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        app.state.event_subs.discard(q)