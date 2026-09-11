"""In-memory runtime scenario state + on-disk config library.

Layout:
    back/configs/<id>.json          one file per saved config
    back/01_full_constellation.json shipped example (read-only, always listed)
"""
from __future__ import annotations
import asyncio, copy, json, time
from pathlib import Path
from typing import Optional

import geometry
from schemas import ScenarioModel


BACK_DIR = Path(__file__).resolve().parent
CONFIG_DIR = BACK_DIR / "configs"
EXAMPLE_PATH = BACK_DIR / "01_full_constellation.json"


def _ensure_dir() -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def _config_path(config_id: str) -> Path:
    safe = "".join(c for c in config_id if c.isalnum() or c in "-_")
    return CONFIG_DIR / f"{safe}.json"


# --------------------------------------------------------------- library

def list_configs() -> list[dict]:
    _ensure_dir()
    out: list[dict] = []

    # example first
    if EXAMPLE_PATH.exists():
        try:
            doc = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
            out.append({
                "id": doc["meta"]["id"],
                "title": doc["meta"].get("title", doc["meta"]["id"]),
                "is_example": True,
                "satellites": len(doc["design"]["satellites"]),
                "ground_sites": len(doc["ground_sites"]),
                "updated_at": EXAMPLE_PATH.stat().st_mtime,
            })
        except Exception:
            pass

    for p in sorted(CONFIG_DIR.glob("*.json")):
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            out.append({
                "id": doc["meta"]["id"],
                "title": doc["meta"].get("title", doc["meta"]["id"]),
                "is_example": False,
                "satellites": len(doc["design"]["satellites"]),
                "ground_sites": len(doc["ground_sites"]),
                "updated_at": p.stat().st_mtime,
            })
        except Exception:
            continue
    return out


def load_config(config_id: str) -> dict:
    """Read a config from disk.  Example is read-only; saved configs are user-owned."""
    if EXAMPLE_PATH.exists():
        doc = json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))
        if doc["meta"]["id"] == config_id:
            return doc
    p = _config_path(config_id)
    if not p.exists():
        raise FileNotFoundError(config_id)
    return json.loads(p.read_text(encoding="utf-8"))


def save_config(doc: dict) -> None:
    """Persist a full scenario.  Validates through Pydantic first."""
    model = ScenarioModel.model_validate(doc)
    _ensure_dir()
    p = _config_path(model.meta.id)
    p.write_text(json.dumps(model.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")


def delete_config(config_id: str) -> bool:
    p = _config_path(config_id)
    if p.exists():
        p.unlink()
        return True
    return False


# --------------------------------------------------------------- store

class ScenarioStore:
    """Holds the *currently active* scenario.  Starts empty (no satellites, no ground sites).

    An empty scenario is a valid object: the geometry module handles zero
    satellites fine (numpy arrays of length 0), and snapshot() returns empty
    lists.  The frontend is expected to offer 'load config' or 'create new'.
    """

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue] = set()

        # runtime knobs
        self.t_s: float = 0.0
        self.playback: float = 20.0
        self.tele_hz: float = 20.0
        self.route_hz: float = 10.0

        self._scenario: dict = self._empty_scenario()
        self._active_config_id: Optional[str] = None
        self._active_is_example: bool = False

    # ---------- empty ----------

    @staticmethod
    def _empty_scenario() -> dict:
        return {
            "schema_version": "cosmo-A-1.0",
            "meta": {"id": "new", "title": "Untitled"},
            "environment": {
                "altitude_km": 550.0,
                "inclination_deg": 87.0,
                "earth_angle0_deg": 12.0,
                "horizon_s": 86400,
                "step_s": 120,
                "min_elevation_deg": 10.0,
                "isl_range_km": 3000.0,
                "target_availability": 0.9,
            },
            "design": {"launch_stage": 3, "planes": [], "satellites": []},
            "ground_sites": [],
            "failures": [],
            "gateway_outages": [],
        }

    # ---------- read ----------

    def snapshot_sync(self) -> dict:
        return self._scenario

    async def snapshot(self) -> dict:
        async with self._lock:
            return copy.deepcopy(self._scenario)

    def meta(self) -> dict:
        return {
            "config_id": self._active_config_id,
            "is_example": self._active_is_example,
            "title": self._scenario["meta"].get("title", ""),
            "satellites": len(self._scenario["design"]["satellites"]),
            "ground_sites": len(self._scenario["ground_sites"]),
        }

    # ---------- load / save / new ----------

    async def load(self, config_id: str) -> dict:
        doc = load_config(config_id)
        # normalise to the schema; raises on bad configs
        model = ScenarioModel.model_validate(doc)
        async with self._lock:
            self._scenario = model.model_dump()
            self._active_config_id = model.meta.id
            self._active_is_example = (
                EXAMPLE_PATH.exists()
                and json.loads(EXAMPLE_PATH.read_text(encoding="utf-8"))["meta"]["id"] == config_id
            )
            self.t_s = 0.0
            self.playback = 20.0
            self.tele_hz = 20.0
            self.route_hz = 10.0
        self._broadcast({"type": "scenario_loaded", "meta": self.meta()})
        return self._scenario

    async def new_empty(self, title: str = "Untitled") -> dict:
        async with self._lock:
            self._scenario = self._empty_scenario()
            self._scenario["meta"]["title"] = title
            self._active_config_id = None
            self._active_is_example = False
            self.t_s = 0.0
        self._broadcast({"type": "scenario_loaded", "meta": self.meta()})
        return self._scenario

    async def set_scenario(self, doc: dict) -> dict:
        """Replace the whole scenario (used by the frontend 'create from scratch' flow)."""
        model = ScenarioModel.model_validate(doc)
        async with self._lock:
            self._scenario = model.model_dump()
            self._active_config_id = None
            self._active_is_example = False
            self.t_s = 0.0
        self._broadcast({"type": "scenario_loaded", "meta": self.meta()})
        return self._scenario

    async def save_as(self, config_id: str, title: str) -> dict:
        async with self._lock:
            self._scenario["meta"]["id"] = config_id
            self._scenario["meta"]["title"] = title
            doc = copy.deepcopy(self._scenario)
        save_config(doc)
        async with self._lock:
            self._active_config_id = config_id
            self._active_is_example = False
        self._broadcast({"type": "scenario_saved", "meta": self.meta()})
        return doc

    # ---------- patch ----------

    async def apply_patch(self, patch: dict) -> dict:
        async with self._lock:
            applied: dict = {}

            for g in patch.get("move_ground_sites") or []:
                for site in self._scenario["ground_sites"]:
                    if site["id"] == g["id"]:
                        site["lat_deg"] = float(g["lat_deg"])
                        site["lon_deg"] = float(g["lon_deg"])
                        applied.setdefault("move_ground_sites", []).append(g)

            add = patch.get("add_ground_site")
            if add:
                if any(g["id"] == add["id"] for g in self._scenario["ground_sites"]):
                    raise ValueError(f"ground site {add['id']} already exists")
                self._scenario["ground_sites"].append(add)
                applied["add_ground_site"] = add

            rem = patch.get("remove_ground_site")
            if rem:
                before = len(self._scenario["ground_sites"])
                self._scenario["ground_sites"] = [
                    g for g in self._scenario["ground_sites"] if g["id"] != rem
                ]
                if len(self._scenario["ground_sites"]) == before:
                    raise ValueError(f"ground site {rem} not found")
                applied["remove_ground_site"] = rem

            if "failures" in patch and patch["failures"] is not None:
                self._scenario["failures"] = patch["failures"]
                applied["failures"] = patch["failures"]

            if "gateway_outages" in patch and patch["gateway_outages"] is not None:
                self._scenario["gateway_outages"] = patch["gateway_outages"]
                applied["gateway_outages"] = patch["gateway_outages"]

            if "seek_s" in patch and patch["seek_s"] is not None:
                self.t_s = float(patch["seek_s"]) % self._scenario["environment"]["horizon_s"]
                applied["seek_s"] = self.t_s

            if "step_s" in patch and patch["step_s"] is not None:
                self._scenario["environment"]["step_s"] = int(patch["step_s"])
                applied["step_s"] = patch["step_s"]

            if "playback" in patch and patch["playback"] is not None:
                self.playback = float(patch["playback"])
                applied["playback"] = self.playback

            if "tele_hz" in patch and patch["tele_hz"] is not None:
                self.tele_hz = float(patch["tele_hz"])
                applied["tele_hz"] = self.tele_hz

            if "route_hz" in patch and patch["route_hz"] is not None:
                self.route_hz = float(patch["route_hz"])
                applied["route_hz"] = self.route_hz

            # best-effort sanity check; a truly empty scenario skips validation
            if self._scenario["design"]["satellites"] and self._scenario["ground_sites"]:
                try:
                    geometry.validate(self._scenario)
                except ValueError as exc:
                    # best-effort rollback
                    self._scenario = self._empty_scenario()
                    raise ValueError(f"Patch rejected: {exc}") from exc

        self._broadcast({"type": "scenario_patch", "applied": applied})
        return applied

    # ---------- pub/sub ----------

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, msg: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass