from __future__ import annotations
from typing import Literal
from pydantic import BaseModel

class SatelliteState(BaseModel):
    id: str
    x_km: float
    y_km: float
    z_km: float
    active: bool
    sunlit: bool

class TelemetryFrame(BaseModel):
    t_s: float
    horizon_s: int
    step_s: int
    satellites: list[SatelliteState]

class RouteEntry(BaseModel):
    gateway: str
    client: str
    path: list[str]
    hops: int
    total_range_km: float | None
    propagation_ms: float | None
    reachable: bool

class RoutesFrame(BaseModel):
    t_s: float
    routes: list[RouteEntry]

class ScenarioPatch(BaseModel):
    move_ground_sites: list[dict] | None = None
    failures: list[dict] | None = None
    gateway_outages: list[dict] | None = None
    seek_s: float | None = None
    step_s: Literal[30, 60, 120, 300] | None = None

class ScenarioAck(BaseModel):
    applied: ScenarioPatch