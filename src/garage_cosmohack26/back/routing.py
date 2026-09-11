from __future__ import annotations
import heapq
from typing import Iterable

def build_graph(edges: Iterable[list]) -> dict[str, list[tuple[str, float]]]:
    g: dict[str, list[tuple[str, float]]] = {}
    for a, b, w in edges:
        g.setdefault(a, []).append((b, float(w)))
        g.setdefault(b, []).append((a, float(w)))
    return g

def dijkstra(graph, src: str, dst: str) -> tuple[list[str], float] | None:
    if src == dst:
        return ([src], 0.0)
    if src not in graph or dst not in graph:
        return None
    dist = {src: 0.0}
    prev: dict[str, str] = {}
    pq = [(0.0, src)]
    seen = set()
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

def optimal_route(snapshot: dict, gateway_id: str, client_id: str) -> dict:
    """Pick the gateway→client route; ground nodes cannot relay, so the path
    must start at a gateway (satellite) and end at a client (ground)."""
    g = build_graph(snapshot["edges"])
    result = dijkstra(g, gateway_id, client_id)
    if result is None:
        return {"gateway": gateway_id, "client": client_id, "path": [], "hops": 0,
                "total_range_km": None, "reachable": False}
    path, total = result
    hops = len(path) - 1
    # crude propagation delay using 300 000 km/s
    prop_ms = total / 300_000.0 * 1000.0
    return {
        "gateway": gateway_id,
        "client": client_id,
        "path": path,
        "hops": hops,
        "total_range_km": round(total, 2),
        "propagation_ms": round(prop_ms, 2),
        "reachable": True,
    }