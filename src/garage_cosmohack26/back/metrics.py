# metrics.py
from __future__ import annotations
import json
import math
import random
import sys
from collections import deque
from copy import deepcopy
from geometry import load, snapshot, R


# --------------------------------------------------------------------------- #
# Routing
# --------------------------------------------------------------------------- #
def bfs_path(edges, src, dst):
    """Shortest path src->dst over undirected edges. Returns list of node ids or None."""
    adj = {}
    for a, b, _ in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    if src not in adj:
        return None
    prev = {src: None}
    q = deque([src])
    while q:
        u = q.popleft()
        if u == dst:
            path = []
            while u is not None:
                path.append(u)
                u = prev[u]
            return path[::-1]
        for v in adj[u]:
            if v not in prev:
                prev[v] = u
                q.append(v)
    return None


def shortest_path_to_any_gateway(edges, client, gateways):
    """Return the shortest path from client to any reachable gateway, or None."""
    best = None
    for gw in gateways:
        p = bfs_path(edges, client, gw)
        if p is not None and (best is None or len(p) < len(best)):
            best = p
    return best


# --------------------------------------------------------------------------- #
# Apply launch stage
# --------------------------------------------------------------------------- #
def effective_scenario(scenario: dict, stage: int | None = None) -> dict:
    s = deepcopy(scenario)
    if stage is not None:
        if stage not in (1, 2, 3):
            raise ValueError('launch_stage must be 1, 2 or 3')
        s['design']['launch_stage'] = stage
    return s


# --------------------------------------------------------------------------- #
# Per-client metrics
# --------------------------------------------------------------------------- #
def client_metrics(scenario: dict) -> dict:
    e = scenario['environment']
    step = e['step_s']
    N = e['horizon_s'] // step
    clients  = [g['id'] for g in scenario['ground_sites'] if g['role'] == 'client']
    gateways = [g['id'] for g in scenario['ground_sites'] if g['role'] == 'gateway']

    vis_hits  = {c: 0 for c in clients}
    path_hits = {c: 0 for c in clients}
    hops_sum  = {c: 0 for c in clients}
    hops_cnt  = {c: 0 for c in clients}
    cur_gap   = {c: 0 for c in clients}
    max_gap   = {c: 0 for c in clients}

    for k in range(N):
        snap   = snapshot(scenario, k * step)
        edges  = snap['edges']
        elev   = snap['elevation_deg']
        min_el = e['min_elevation_deg']

        for c in clients:
            visible = any(elev[c][s] >= min_el for s in elev[c])
            if visible:
                vis_hits[c] += 1

            path = shortest_path_to_any_gateway(edges, c, gateways)
            if path is None:
                cur_gap[c] += 1
                if cur_gap[c] > max_gap[c]:
                    max_gap[c] = cur_gap[c]
            else:
                path_hits[c] += 1
                hops_sum[c]  += len(path) - 1
                hops_cnt[c]  += 1
                cur_gap[c]    = 0

    out = {}
    for c in clients:
        out[c] = {
            'visibility_pct':           100.0 * vis_hits[c] / N,
            'gateway_availability_pct': 100.0 * path_hits[c] / N,
            'max_interruption_s':       max_gap[c] * step,
            'avg_hops': (hops_sum[c] / hops_cnt[c]) if hops_cnt[c] else None,
        }
    return out


# --------------------------------------------------------------------------- #
# Full result export
# --------------------------------------------------------------------------- #
def build_result(scenario: dict, stage: int | None = None) -> dict:
    eff = effective_scenario(scenario, stage)
    e    = eff['environment']
    step = e['step_s']
    N    = e['horizon_s'] // step
    clients  = [g['id'] for g in eff['ground_sites'] if g['role'] == 'client']
    gateways = [g['id'] for g in eff['ground_sites'] if g['role'] == 'gateway']

    routes = []
    for k in range(N):
        t_s  = k * step
        snap = snapshot(eff, t_s)
        edges = snap['edges']
        for c in clients:
            path = shortest_path_to_any_gateway(edges, c, gateways)
            routes.append({
                't_s':       t_s,
                'client_id': c,
                'path':      path if path is not None else [],
            })

    return {
        'schema_version':     'cosmo-A-result-1.0',
        'effective_scenario': eff,
        'routes':             routes,
        'metrics':            client_metrics(eff),
    }


def save_result(result: dict, path: str) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2, allow_nan=False)


# --------------------------------------------------------------------------- #
# Compare two configurations
# --------------------------------------------------------------------------- #
_METRIC_KEYS = (
    'visibility_pct',
    'gateway_availability_pct',
    'max_interruption_s',
    'avg_hops',
)


def _diff_scalar(a, b):
    if a is None or b is None:
        return None
    return b - a


def compare(scenario_a: dict, scenario_b: dict) -> dict:
    ma = client_metrics(scenario_a)
    mb = client_metrics(scenario_b)

    clients = sorted(set(ma) | set(mb))
    metrics = {}
    for c in clients:
        metrics[c] = {}
        for key in _METRIC_KEYS:
            va = ma.get(c, {}).get(key)
            vb = mb.get(c, {}).get(key)
            metrics[c][key] = {'a': va, 'b': vb, 'delta': _diff_scalar(va, vb)}

    ea, eb = scenario_a['environment'], scenario_b['environment']
    da, db = scenario_a['design'],      scenario_b['design']
    changed = {}

    for key in ('altitude_km', 'inclination_deg', 'earth_angle0_deg',
                'horizon_s', 'step_s', 'min_elevation_deg',
                'isl_range_km', 'target_availability'):
        if ea.get(key) != eb.get(key):
            changed[f'environment.{key}'] = {'a': ea.get(key), 'b': eb.get(key)}

    if da.get('launch_stage') != db.get('launch_stage'):
        changed['design.launch_stage'] = {
            'a': da.get('launch_stage'), 'b': db.get('launch_stage')
        }

    planes_a = {p['id']: (p['raan_deg'], p['phase_deg']) for p in da.get('planes', [])}
    planes_b = {p['id']: (p['raan_deg'], p['phase_deg']) for p in db.get('planes', [])}
    for pid in sorted(set(planes_a) | set(planes_b)):
        if planes_a.get(pid) != planes_b.get(pid):
            changed[f'planes.{pid}'] = {'a': planes_a.get(pid), 'b': planes_b.get(pid)}

    sats_a = {s['id']: (s['plane_id'], s['slot_deg'], s['launch_batch'])
              for s in da.get('satellites', [])}
    sats_b = {s['id']: (s['plane_id'], s['slot_deg'], s['launch_batch'])
              for s in db.get('satellites', [])}
    for sid in sorted(set(sats_a) | set(sats_b)):
        if sats_a.get(sid) != sats_b.get(sid):
            changed[f'satellites.{sid}'] = {'a': sats_a.get(sid), 'b': sats_b.get(sid)}

    fa, fb = scenario_a.get('failures', []), scenario_b.get('failures', [])
    if fa != fb:
        changed['failures'] = {'a': fa, 'b': fb}

    ga, gb = scenario_a.get('gateway_outages', []), scenario_b.get('gateway_outages', [])
    if ga != gb:
        changed['gateway_outages'] = {'a': ga, 'b': gb}

    return {
        'metrics': metrics,
        'changed_parameters': changed,
        'same_time_grid': (ea.get('horizon_s') == eb.get('horizon_s')
                           and ea.get('step_s') == eb.get('step_s')),
    }


# =========================================================================== #
# OPTIMAL CONFIGURATION SEARCH
# =========================================================================== #

# --------------------------------------------------------------------------- #
# Analytical bounds
# --------------------------------------------------------------------------- #
def footprint_half_angle(altitude_km: float, el_min_deg: float) -> float:
    """Half-angle (radians) of the ground footprint at elevation >= el_min."""
    r = R + altitude_km
    el = math.radians(el_min_deg)
    return math.acos((R / r) * math.cos(el)) - el


def min_sats_per_plane(altitude_km: float, isl_range_km: float,
                       el_min_deg: float) -> int:
    """Smallest N_per_plane that is both gapless along-track and ISL-connected."""
    lam = footprint_half_angle(altitude_km, el_min_deg)
    r = R + altitude_km
    # Along-track gapless: 2*lam >= 2*pi / N  ->  N >= pi / lam
    n_gapless = math.ceil(math.pi / lam)
    # ISL ring connectivity: chord(2*pi/N) < isl_range
    ratio = min(1.0, isl_range_km / (2.0 * r))
    n_isl = math.ceil(math.pi / math.asin(ratio))
    return max(n_gapless, n_isl)


def analytical_bounds(n_sat: int, n_planes: int, altitude_km: float,
                      isl_range_km: float, el_min_deg: float) -> dict:
    lam = footprint_half_angle(altitude_km, el_min_deg)
    n_min_pp = min_sats_per_plane(altitude_km, isl_range_km, el_min_deg)
    n_pp = max(n_min_pp, math.ceil(n_sat / n_planes))
    return {
        'footprint_half_angle_deg': math.degrees(lam),
        'footprint_radius_km':      R * lam,
        'min_sats_per_plane':       n_min_pp,
        'sats_per_plane_used':      n_pp,
        'sats_total_used':          n_pp * n_planes,
        'raan_step_deg':            360.0 / n_planes,
    }


# --------------------------------------------------------------------------- #
# Seed design: Walker-Delta
# --------------------------------------------------------------------------- #
def seed_design(base: dict, n_sat: int, n_planes: int,
                raan_step_deg: float | None = None,
                inclination_deg: float | None = None,
                f_factor: int = 1) -> dict:
    """
    Build a Walker-Delta scenario on top of `base` (which supplies environment,
    ground_sites, failures, gateway_outages). Replaces design.planes and
    design.satellites.
    """
    e = base['environment']
    h = e['altitude_km']
    isl = e['isl_range_km']
    el_min = e['min_elevation_deg']

    # Choose N_per_plane to satisfy the analytical minimum.
    n_min_pp = min_sats_per_plane(h, isl, el_min)
    n_pp = max(n_min_pp, math.ceil(n_sat / n_planes))
    n_sat_actual = n_pp * n_planes

    if inclination_deg is None:
        # Inclination at least as high as the highest |client latitude| + margin.
        max_client_lat = max(
            (abs(g['lat_deg']) for g in base['ground_sites'] if g['role'] == 'client'),
            default=60.0)
        inclination_deg = min(180.0, max_client_lat + 5.0)

    if raan_step_deg is None:
        raan_step_deg = 360.0 / n_planes

    s = deepcopy(base)
    s['design']['launch_stage'] = max(sat.get('launch_batch', 1)
                                      for sat in s.get('design', {}).get('satellites', [])
                                      ) if s.get('design', {}).get('satellites') else 3

    s['environment']['inclination_deg'] = float(inclination_deg)

    planes = []
    for k in range(n_planes):
        planes.append({
            'id': f'P{k + 1}',
            'raan_deg': (k * raan_step_deg) % 360.0,
            'phase_deg': (k * f_factor * 360.0 / n_sat_actual) % 360.0,
        })

    satellites = []
    idx = 0
    for k, p in enumerate(planes):
        for j in range(n_pp):
            idx += 1
            satellites.append({
                'id': f'S{idx:02d}',
                'plane_id': p['id'],
                'slot_deg': (j * 360.0 / n_pp) % 360.0,
                'launch_batch': 1,
            })

    s['design']['planes'] = planes
    s['design']['satellites'] = satellites
    s['design']['launch_stage'] = 3
    return s


# --------------------------------------------------------------------------- #
# Objective
# --------------------------------------------------------------------------- #
def objective(metrics: dict, n_sat: int,
              target: float = 0.9,
              lambda_avail: float = 1e4,
              mu_gap: float = 1e-2,
              nu_hops: float = 1.0) -> float:
    """
    Scalar cost to minimize:
        J = N_sat
          + lambda_avail * sum_c max(0, target - availability(c))
          + mu_gap       * sum_c max_interruption_s(c)
          + nu_hops      * mean_c avg_hops(c)
    Availability and interruption dominate; hops is a tie-breaker.
    """
    if not metrics:
        return float('inf')
    penalty_avail = 0.0
    penalty_gap   = 0.0
    hops_vals     = []
    for c, m in metrics.items():
        avail = m['gateway_availability_pct'] / 100.0
        penalty_avail += max(0.0, target - avail)
        penalty_gap   += m['max_interruption_s']
        if m['avg_hops'] is not None:
            hops_vals.append(m['avg_hops'])
    mean_hops = sum(hops_vals) / len(hops_vals) if hops_vals else 0.0
    return (n_sat
            + lambda_avail * penalty_avail
            + mu_gap       * penalty_gap
            + nu_hops      * mean_hops)


def evaluate(scenario: dict) -> dict:
    """Thin wrapper so the search code has one place to change."""
    return client_metrics(scenario)


def score(scenario: dict) -> tuple[float, dict]:
    m = evaluate(scenario)
    n_sat = len(scenario['design']['satellites'])
    return objective(m, n_sat), m


# --------------------------------------------------------------------------- #
# Search: random perturbations + coordinate descent
# --------------------------------------------------------------------------- #
def _mutate(design: dict, rng: random.Random,
            raan_sigma: float = 5.0,
            phase_sigma: float = 3.0,
            inc_sigma: float = 1.0) -> dict:
    """Return a perturbed copy of the design (planes + inclination)."""
    s = deepcopy(design)
    for p in s['design']['planes']:
        p['raan_deg']  = (p['raan_deg']  + rng.gauss(0.0, raan_sigma))  % 360.0
        p['phase_deg'] = (p['phase_deg'] + rng.gauss(0.0, phase_sigma)) % 360.0
    s['environment']['inclination_deg'] = max(
        0.1, min(179.9,
                 s['environment']['inclination_deg'] + rng.gauss(0.0, inc_sigma)))
    return s


def optimize(base: dict, n_sat: int, n_planes: int,
             iterations: int = 200,
             seed: int = 0,
             f_factor: int = 1,
             raan_step_deg: float | None = None,
             inclination_deg: float | None = None) -> dict:
    """
    Search for a good Walker-Delta-like configuration.

    Returns:
      {
        "best_scenario": <scenario dict>,
        "best_metrics":  <client_metrics output>,
        "best_score":    <float>,
        "bounds":        <analytical_bounds output>,
        "history":       [ {"iter": i, "score": s, "metrics": m}, ... ]
      }
    """
    rng = random.Random(seed)

    bounds = analytical_bounds(
        n_sat, n_planes,
        base['environment']['altitude_km'],
        base['environment']['isl_range_km'],
        base['environment']['min_elevation_deg'],
    )

    best = seed_design(base, n_sat, n_planes,
                       raan_step_deg=raan_step_deg,
                       inclination_deg=inclination_deg,
                       f_factor=f_factor)
    best_score_val, best_metrics = score(best)
    history = [{'iter': 0, 'score': best_score_val, 'metrics': best_metrics}]

    for i in range(1, iterations + 1):
        cand = _mutate(best, rng)
        s_val, m_val = score(cand)
        if s_val < best_score_val:
            best, best_score_val, best_metrics = cand, s_val, m_val
        history.append({'iter': i, 'score': s_val, 'metrics': m_val})

    return {
        'best_scenario': best,
        'best_metrics':  best_metrics,
        'best_score':    best_score_val,
        'bounds':        bounds,
        'history':       history,
    }


# --------------------------------------------------------------------------- #
# Greedy satellite addition
# --------------------------------------------------------------------------- #
def greedy_add_satellites(base: dict, n_planes: int,
                          max_sats: int = 96,
                          target: float = 0.9,
                          n_candidates: int = 16,
                          seed: int = 0) -> dict:
    """
    Start with the analytical minimum and add satellites one at a time,
    choosing the slot that most improves the worst-client availability,
    until every client meets `target` or `max_sats` is reached.

    Returns:
      {
        "best_scenario": <scenario>,
        "best_metrics":  <metrics>,
        "n_satellites":  <int>,
        "met_target":    <bool>,
        "steps":         [ {"n": k, "min_avail": ..., "score": ...}, ... ]
      }
    """
    rng = random.Random(seed)
    e = base['environment']
    n_min_pp = min_sats_per_plane(e['altitude_km'], e['isl_range_km'],
                                  e['min_elevation_deg'])
    n_per_plane = max(n_min_pp, math.ceil(1 / n_planes))
    n_sat = n_per_plane * n_planes
    n_sat = min(n_sat, max_sats)

    best = seed_design(base, n_sat, n_planes)
    best_metrics = evaluate(best)
    best_score_val, _ = score(best)

    steps = [{'n': n_sat,
              'min_avail': min(m['gateway_availability_pct'] / 100.0
                               for m in best_metrics.values()),
              'score': best_score_val}]

    while n_sat < max_sats:
        min_avail = min(m['gateway_availability_pct'] / 100.0
                        for m in best_metrics.values())
        if min_avail >= target:
            break

        # Try adding one satellite in each plane at several candidate slots.
        best_cand, best_cand_score, best_cand_metrics = None, float('inf'), None
        for plane in best['design']['planes']:
            for _ in range(n_candidates):
                cand = deepcopy(best)
                # Insert a new satellite in this plane at a random slot.
                idx = len(cand['design']['satellites']) + 1
                cand['design']['satellites'].append({
                    'id': f'S{idx:03d}',
                    'plane_id': plane['id'],
                    'slot_deg': rng.uniform(0.0, 360.0),
                    'launch_batch': 1,
                })
                s_val, m_val = score(cand)
                if s_val < best_cand_score:
                    best_cand, best_cand_score, best_cand_metrics = cand, s_val, m_val

        if best_cand is None:
            break
        best, best_score_val, best_metrics = best_cand, best_cand_score, best_cand_metrics
        n_sat += 1
        steps.append({'n': n_sat,
                      'min_avail': min(m['gateway_availability_pct'] / 100.0
                                       for m in best_metrics.values()),
                      'score': best_score_val})

    min_avail = min(m['gateway_availability_pct'] / 100.0
                    for m in best_metrics.values())
    return {
        'best_scenario': best,
        'best_metrics':  best_metrics,
        'n_satellites':  n_sat,
        'met_target':    min_avail >= target,
        'steps':         steps,
    }


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _cli():
    if len(sys.argv) == 2:
        s = load(sys.argv[1])
        print(json.dumps(client_metrics(s), indent=2, ensure_ascii=False))
        return

    if len(sys.argv) == 3 and sys.argv[1] == 'export':
        s = load(sys.argv[2])
        print(json.dumps(build_result(s), indent=2, ensure_ascii=False))
        return

    if len(sys.argv) == 4 and sys.argv[1] == 'compare':
        a = load(sys.argv[2]); b = load(sys.argv[3])
        print(json.dumps(compare(a, b), indent=2, ensure_ascii=False))
        return

    if len(sys.argv) >= 5 and sys.argv[1] == 'optimize':
        # python metrics.py optimize <base.json> <n_sat> <n_planes> [iters] [seed]
        base = load(sys.argv[2])
        n_sat = int(sys.argv[3])
        n_planes = int(sys.argv[4])
        iters = int(sys.argv[5]) if len(sys.argv) > 5 else 200
        seed = int(sys.argv[6]) if len(sys.argv) > 6 else 0
        out = optimize(base, n_sat, n_planes, iterations=iters, seed=seed)
        # Keep the response compact.
        print(json.dumps({
            'best_score': out['best_score'],
            'bounds': out['bounds'],
            'best_metrics': out['best_metrics'],
            'best_scenario': out['best_scenario'],
        }, indent=2, ensure_ascii=False))
        return

    if len(sys.argv) >= 4 and sys.argv[1] == 'greedy':
        # python metrics.py greedy <base.json> <n_planes> [max_sats] [target] [seed]
        base = load(sys.argv[2])
        n_planes = int(sys.argv[3])
        max_sats = int(sys.argv[4]) if len(sys.argv) > 4 else 96
        target = float(sys.argv[5]) if len(sys.argv) > 5 else 0.9
        seed = int(sys.argv[6]) if len(sys.argv) > 6 else 0
        out = greedy_add_satellites(base, n_planes,
                                    max_sats=max_sats, target=target, seed=seed)
        print(json.dumps({
            'n_satellites': out['n_satellites'],
            'met_target': out['met_target'],
            'best_metrics': out['best_metrics'],
            'steps': out['steps'],
            'best_scenario': out['best_scenario'],
        }, indent=2, ensure_ascii=False))
        return

    raise SystemExit(
        'Usage:\n'
        '  python metrics.py <scenario.json>\n'
        '  python metrics.py export <scenario.json>\n'
        '  python metrics.py compare <a.json> <b.json>\n'
        '  python metrics.py optimize <base.json> <n_sat> <n_planes> [iters] [seed]\n'
        '  python metrics.py greedy   <base.json> <n_planes> [max_sats] [target] [seed]'
    )


if __name__ == '__main__':
    _cli()