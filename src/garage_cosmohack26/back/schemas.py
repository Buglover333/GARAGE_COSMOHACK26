"""Pydantic models for scenario configs and runtime frames."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------------------- config models

class PlaneModel(BaseModel):
    id: str
    raan_deg: float = Field(ge=0, lt=360)
    phase_deg: float = Field(ge=0, lt=360)


class SatelliteModel(BaseModel):
    id: str
    plane_id: str
    slot_deg: float
    launch_batch: Literal[1, 2, 3] = 1


class DesignModel(BaseModel):
    launch_stage: Literal[1, 2, 3] = 3
    planes: list[PlaneModel] = []
    satellites: list[SatelliteModel] = []


class EnvironmentModel(BaseModel):
    altitude_km: float = Field(ge=200, le=1200)
    inclination_deg: float = Field(gt=0, le=180)
    earth_angle0_deg: float = 12.0
    horizon_s: int = Field(gt=0, le=172800)
    step_s: int = Field(gt=0)
    min_elevation_deg: float = Field(ge=0, lt=90)
    isl_range_km: float = Field(gt=0, le=10000)
    target_availability: float = Field(ge=0, le=1)

    @field_validator("step_s")
    @classmethod
    def _step_divides_horizon(cls, v: int, info):
        h = info.data.get("horizon_s")
        if h and h % v != 0:
            raise ValueError("horizon_s must be a multiple of step_s")
        return v


class GroundSiteModel(BaseModel):
    id: str
    name: str = ""
    role: Literal["gateway", "client"]
    lat_deg: float = Field(ge=-90, le=90)
    lon_deg: float = Field(ge=-180, le=180)


class MetaModel(BaseModel):
    id: str
    title: str = ""


class ScenarioModel(BaseModel):
    """Full scenario as stored in a config file."""
    schema_version: Literal["cosmo-A-1.0"] = "cosmo-A-1.0"
    meta: MetaModel
    environment: EnvironmentModel
    design: DesignModel
    ground_sites: list[GroundSiteModel] = []
    failures: list[dict] = []
    gateway_outages: list[dict] = []


# --------------------------------------------------------------- library models

class ConfigSummary(BaseModel):
    id: str
    title: str
    is_example: bool = False
    satellites: int = 0
    ground_sites: int = 0
    updated_at: float = 0.0


# --------------------------------------------------------------- runtime frames

class SatelliteState(BaseModel):
    id: str
    x_km: float
    y_km: float
    z_km: float
    active: bool
    sunlit: bool


class TelemetryFrame(BaseModel):
    type: Literal["telemetry"] = "telemetry"
    t_s: float
    horizon_s: int
    step_s: int
    satellites: list[SatelliteState]
    edges: list[list] = []


class RouteEntry(BaseModel):
    gateway: str
    client: str
    path: list[str]
    hops: int
    total_range_km: Optional[float] = None
    propagation_ms: Optional[float] = None
    reachable: bool


class RoutesFrame(BaseModel):
    type: Literal["routes"] = "routes"
    t_s: float
    routes: list[RouteEntry]


# --------------------------------------------------------------- control models

class ScenarioPatch(BaseModel):
    move_ground_sites: Optional[list[dict]] = None
    add_ground_site: Optional[GroundSiteModel] = None
    remove_ground_site: Optional[str] = None
    failures: Optional[list[dict]] = None
    gateway_outages: Optional[list[dict]] = None
    seek_s: Optional[float] = None
    step_s: Optional[Literal[30, 60, 120, 300]] = None
    playback: Optional[float] = Field(default=None, gt=0, le=500)
    tele_hz: Optional[float] = Field(default=None, gt=0, le=60)
    route_hz: Optional[float] = Field(default=None, gt=0, le=60)


class ScenarioAck(BaseModel):
    applied: dict


class ScenarioError(BaseModel):
    error: str