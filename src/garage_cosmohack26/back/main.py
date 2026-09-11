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

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse

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


# --------------------------------------------------------------- paths
BACK_DIR = Path(__file__).resolve().parent
FRONT_DIR = BACK_DIR.parent / "front"
INDEX_HTML = FRONT_DIR / "index.html"


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
    doc = await store.save_as(config_id, title or config_id)
    return {"saved": config_id, "meta": store.meta()}


@app.post("/api/configs/upload", tags=["configs"])
async def api_upload_config(doc: ScenarioModel, as_id: Optional[str] = None):
    target = as_id or doc.meta.id
    if not target:
        raise HTTPException(400, "config id missing")
    doc.meta.id = target
    save_config(doc.model_dump())
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
    return {"loaded": config_id, "meta": store.meta()}


@app.post("/api/scenario/new", tags=["scenario"])
async def api_new(title: str = "Untitled"):
    await store.new_empty(title)
    return {"meta": store.meta()}


@app.put("/api/scenario", tags=["scenario"])
async def api_replace(doc: ScenarioModel):
    await store.set_scenario(doc.model_dump())
    return {"meta": store.meta()}


@app.post("/api/scenario/patch", response_model=ScenarioAck, tags=["scenario"])
async def api_patch(patch: ScenarioPatch):
    try:
        applied = await store.apply_patch(patch.model_dump(exclude_none=True))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return ScenarioAck(applied=applied)


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

    # Both analyses run in the thread pool.  Same underlying analyze() means
    # a repeat comparison of the same pair is instant thanks to the cache.
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
#  Static frontend
# ================================================================

@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index():
    if INDEX_HTML.exists():
        return HTMLResponse(INDEX_HTML.read_text(encoding="utf-8"))
    return HTMLResponse(
        "<h1>Constellation Simulator</h1>"
        f"<p>Put your frontend at <code>{INDEX_HTML}</code>.</p>"
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