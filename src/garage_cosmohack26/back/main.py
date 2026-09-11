from __future__ import annotations
import asyncio, contextlib, json, math, time
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import geometry
from scenario_store import ScenarioStore
from routing import optimal_route

SCENARIO = Path(__file__).parent / "01_full_constellation.json"
store = ScenarioStore(SCENARIO)

app = FastAPI(title="Constellation Simulator")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from schemas import (
    TelemetryFrame, RoutesFrame, ScenarioPatch, ScenarioAck,
)

SUN_ECI = [1.0, 0.0, 0.0]  # same constant you use in the sim loop

@app.get(
    "/api/telemetry",
    response_model=TelemetryFrame,
    tags=["snapshot"],
    summary="One-shot satellite positions (same payload as /ws/telemetry)",
)
async def get_telemetry():
    scen = store.snapshot_sync()
    snap = geometry.snapshot(scen, store.t_s)
    sun  = geometry.sunlight(scen, store.t_s, SUN_ECI)
    return TelemetryFrame(
        t_s=snap["t_s"],
        horizon_s=scen["environment"]["horizon_s"],
        step_s=scen["environment"]["step_s"],
        satellites=[{**s, "sunlit": sun.get(s["id"], True)} for s in snap["satellites"]],
    )

@app.get(
    "/api/routes",
    response_model=RoutesFrame,
    tags=["snapshot"],
    summary="One-shot optimal routes (same payload as /ws/route)",
)
async def get_routes():
    scen = store.snapshot_sync()
    snap = geometry.snapshot(scen, store.t_s)
    routes = []
    for gw in [g["id"] for g in scen["ground_sites"] if g["role"] == "gateway"]:
        for cl in [g["id"] for g in scen["ground_sites"] if g["role"] == "client"]:
            r = optimal_route(snap, gw, cl)
            r["t_s"] = snap["t_s"]
            routes.append(r)
    return RoutesFrame(t_s=snap["t_s"], routes=routes)

@app.post(
    "/api/scenario/patch",
    response_model=ScenarioAck,
    tags=["control"],
    summary="Apply a scenario edit (same body as /ws/scenario)",
)
async def patch_scenario(patch: ScenarioPatch):
    applied = await store.apply_patch(patch.model_dump(exclude_none=True))
    return ScenarioAck(applied=applied)

@app.get(
    "/api/scenario",
    tags=["control"],
    summary="Current scenario (public view)",
)
async def get_scenario():
    return _public_scenario(store.snapshot_sync())

# ---------------------------------------------------------------- broadcaster
async def simulation_loop():
    """Single authoritative clock.  Publishes telemetry + routes + events to
    the per-connection queues held by the WS handlers."""
    telemetry_subs: set[asyncio.Queue] = set()
    route_subs:     set[asyncio.Queue] = set()
    event_subs:     set[asyncio.Queue] = set()

    app.state.telemetry_subs = telemetry_subs
    app.state.route_subs     = route_subs
    app.state.event_subs     = event_subs

    prev_state: dict = {}  # for edge-diff events
    sun_eci = [1.0, 0.0, 0.0]  # replace with a real ephemeris if needed

    # pre-warm so first frame isn't empty
    while True:
        try:
            scen = store.snapshot_sync()
            step = store.step_s
            horizon = store.horizon_s

            # --- 1. positions / telemetry ---
            snap = geometry.snapshot(scen, store.t_s)
            sun  = geometry.sunlight(scen, store.t_s, sun_eci)

            tele_payload = {
                "type": "telemetry",
                "t_s": snap["t_s"],
                "horizon_s": horizon,
                "step_s": step,
                "satellites": [
                    {**sat, "sunlit": sun.get(sat["id"], True)}
                    for sat in snap["satellites"]
                ],
            }
            for q in list(telemetry_subs):
                _put(q, tele_payload)

            # --- 2. optimal routes for every gateway→client pair ---
            gateways = [g["id"] for g in scen["ground_sites"] if g["role"] == "gateway"]
            clients  = [g["id"] for g in scen["ground_sites"] if g["role"] == "client"]
            routes = []
            for gw in gateways:
                for cl in clients:
                    r = optimal_route(snap, gw, cl)
                    r["t_s"] = snap["t_s"]
                    routes.append(r)
            route_payload = {"type": "routes", "t_s": snap["t_s"], "routes": routes}
            for q in list(route_subs):
                _put(q, route_payload)

            # --- 3. discrete events (link up/down, handovers) ---
            events = _diff_edges(prev_state.get("edges", []), snap["edges"], snap["t_s"])
            if events:
                ev_payload = {"type": "events", "t_s": snap["t_s"], "events": events}
                for q in list(event_subs):
                    _put(q, ev_payload)
            prev_state["edges"] = snap["edges"]

            # --- advance clock ---
            store.t_s = (store.t_s + step) % horizon
            await asyncio.sleep(step / 20.0)   # 20× real-time playback; tune
        except Exception as exc:  # keep loop alive
            await asyncio.sleep(1.0)


def _put(q: asyncio.Queue, item: dict) -> None:
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        # drop oldest then retry — telemetry is fine to drop
        with contextlib.suppress(asyncio.QueueEmpty):
            q.get_nowait()
        with contextlib.suppress(asyncio.QueueFull):
            q.put_nowait(item)


def _diff_edges(old: list, new: list, t_s: float) -> list[dict]:
    old_set = {tuple(sorted((a, b))) for a, b, _ in old}
    new_set = {tuple(sorted((a, b))) for a, b, _ in new}
    events = []
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


# ============================================================ 1. TELEMETRY
@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=8)
    app.state.telemetry_subs.add(q)
    try:
        # initial snapshot so the client can render immediately
        scen = store.snapshot_sync()
        await ws.send_json({
            "type": "telemetry_init",
            "scenario": _public_scenario(scen),
        })
        while True:
            item = await q.get()
            await ws.send_json(item)
    except WebSocketDisconnect:
        pass
    finally:
        app.state.telemetry_subs.discard(q)


# ============================================================ 2. ROUTE
@app.websocket("/ws/route")
async def ws_route(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=8)
    app.state.route_subs.add(q)
    try:
        while True:
            item = await q.get()
            await ws.send_json(item)
    except WebSocketDisconnect:
        pass
    finally:
        app.state.route_subs.discard(q)


# ============================================================ 3. SCENARIO (control)
@app.websocket("/ws/scenario")
async def ws_scenario(ws: WebSocket):
    await ws.accept()
    q = store.subscribe()
    try:
        await ws.send_json({"type": "scenario_ready",
                            "scenario": _public_scenario(store.snapshot_sync())})
        while True:
            # multiplex: incoming frontend edits + outgoing broadcasts
            recv_task = asyncio.create_task(ws.receive_json())
            pub_task  = asyncio.create_task(q.get())
            done, pending = await asyncio.wait(
                {recv_task, pub_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
            if recv_task in done:
                patch = recv_task.result()
                try:
                    applied = await store.apply_patch(patch)
                    await ws.send_json({"type": "scenario_ack", "applied": applied})
                except ValueError as exc:
                    await ws.send_json({"type": "scenario_error", "error": str(exc)})
            if pub_task in done:
                await ws.send_json(pub_task.result())
    except WebSocketDisconnect:
        pass
    finally:
        store.unsubscribe(q)


# ============================================================ 4. EVENTS
@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    app.state.event_subs.add(q)
    try:
        while True:
            item = await q.get()
            await ws.send_json(item)
    except WebSocketDisconnect:
        pass
    finally:
        app.state.event_subs.discard(q)


# ============================================================ helpers
def _public_scenario(s: dict) -> dict:
    """Strip anything the frontend shouldn't see; currently a passthrough."""
    return {
        "meta": s["meta"],
        "environment": s["environment"],
        "design": s["design"],
        "ground_sites": s["ground_sites"],
        "failures": s["failures"],
        "gateway_outages": s["gateway_outages"],
    }