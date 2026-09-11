from __future__ import annotations
import asyncio, copy, json
from pathlib import Path
from typing import Any
import geometry

class ScenarioStore:
    """Thread-safe-ish (asyncio) holder for the live scenario.

    geometry.snapshot() reads a plain dict, so we keep the scenario as a dict
    and swap it atomically.  Multiple WS handlers share one store.
    """

    def __init__(self, path: str | Path):
        self._base = geometry.load(path)
        self._scenario: dict = copy.deepcopy(self._base)
        self._lock = asyncio.Lock()
        self._subscribers: set[asyncio.Queue] = set()
        # global simulation clock (seconds)
        self.t_s: float = 0.0
        self.step_s: int = self._scenario["environment"]["step_s"]
        self.horizon_s: int = self._scenario["environment"]["horizon_s"]

    # ---- read access ----
    async def snapshot(self) -> dict:
        async with self._lock:
            return copy.deepcopy(self._scenario)

    def snapshot_sync(self) -> dict:
        return self._scenario  # fine for read-only use in the sim loop

    # ---- mutation ----
    async def apply_patch(self, patch: dict) -> dict:
        """Apply a frontend edit.  Returns the diff actually applied."""
        async with self._lock:
            applied = {}

            # move a ground site
            for g in patch.get("move_ground_sites", []):
                for site in self._scenario["ground_sites"]:
                    if site["id"] == g["id"]:
                        site["lat_deg"] = float(g["lat_deg"])
                        site["lon_deg"] = float(g["lon_deg"])
                        applied.setdefault("move_ground_sites", []).append(g)

            # add / remove / replace outages
            if "failures" in patch:
                self._scenario["failures"] = patch["failures"]
                applied["failures"] = patch["failures"]
            if "gateway_outages" in patch:
                self._scenario["gateway_outages"] = patch["gateway_outages"]
                applied["gateway_outages"] = patch["gateway_outages"]

            # jump in time
            if "seek_s" in patch:
                self.t_s = float(patch["seek_s"]) % self.horizon_s
                applied["seek_s"] = self.t_s

            # change time step / speed
            if "step_s" in patch and patch["step_s"] in (30, 60, 120, 300):
                self.step_s = int(patch["step_s"])
                applied["step_s"] = self.step_s

            # re-validate: cheapest safety net
            try:
                geometry.validate(self._scenario)
            except ValueError as exc:
                # roll back
                self._scenario = copy.deepcopy(self._base)
                raise ValueError(f"Patch rejected: {exc}") from exc

        # notify all subscribers (fire-and-forget)
        for q in list(self._subscribers):
            try:
                q.put_nowait({"type": "scenario_patch", "applied": applied})
            except asyncio.QueueFull:
                pass
        return applied

    # ---- pub/sub for /ws/scenario ----
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)