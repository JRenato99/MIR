from fastapi import APIRouter, HTTPException
from core.db import fetch_all
from math import cos, sin
from datetime import datetime
from typing import Dict, Tuple, List
from collections import defaultdict
from core.util import _angle_from_id

router = APIRouter(prefix="/graph", tags=["graph"])

USE_UNIFIED_VIEWS_FOR_FULL = True


def _load_positions_map() -> Dict[str, Tuple[float, float]]:
    """
    Lee posiciones guardadas en dbo.graph_node_position.
    """
    try:
        rows = fetch_all(
            """
            SELECT node_id, x, y
            FROM dbo.graph_node_position
            """
        )
        out: Dict[str, Tuple[float, float]] = {}
        for r in rows:
            nid = r.get("node_id")
            x = r.get("x")
            y = r.get("y")
            if nid is not None and x is not None and y is not None:
                out[str(nid)] = (float(x), float(y))
        return out
    except Exception:
        return {}


@router.get("/overview")
def get_nodes_overview():
    """
    Las demás rutas se dibujan como enlaces directos:
        from_nodo -> to_nodo
    """

    try:
        # 1) NODOS físicos
        nodes_rows = fetch_all(
            """
            SELECT
                CAST(id AS NVARCHAR(200)) AS id,
                name AS label,
                code,
                type,
                reference,
                gps_lat,
                gps_lon
            FROM dbo.nodo;
            """
        )

        # 2) Rutas NODO-NODO (sin mufas)
        routes_rows = fetch_all(
            """
            SELECT
                route_id,
                CAST(from_nodo_id AS NVARCHAR(200)) AS from_nodo_id,
                CAST(to_nodo_id   AS NVARCHAR(200)) AS to_nodo_id,
                path_text
            FROM dbo.vw_backbone_edges;
            """
        )

        # 3) Mufas por ruta (usando spans de la ruta + mufa.pole_id)
        # Para cada route_id, obtenemos TODAS las mufas en su recorrido.
        route_mufa_rows = fetch_all(
            """
            SELECT DISTINCT
                ors.odf_route_id      AS route_id,
                m.id                  AS mufa_id,
                m.code                AS mufa_code
            FROM dbo.odf_route_segment ors
            JOIN dbo.cable_span cs
                ON cs.id = ors.cable_span_id
            JOIN dbo.mufa m
                ON m.pole_id IN (cs.from_pole_id, cs.to_pole_id);
            """
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"BD_ERROR_OVERVIEW: {e}")

    pos_map = _load_positions_map()

    # --------------------------------------------------
    # NODOS BASE: NODOS FÍSICOS (tabla nodo)
    # --------------------------------------------------
    vis_nodes: List[dict] = []
    R = 350.0

    for n in nodes_rows:
        nid = n["id"]
        if nid in pos_map:
            x, y = pos_map[nid]
            fixed_xy = True
        else:
            # Layout circular determinístico por id
            a = _angle_from_id(nid)
            x, y = R * cos(a), R * sin(a)
            fixed_xy = True

        ref = n.get("reference") or n.get("nodo_reference")
        gps_lat = n.get("gps_lat")
        gps_lon = n.get("gps_lon")

        vis_nodes.append(
            {
                "id": nid,
                "label": n.get("label") or nid,
                "group": "nodo",
                "kind": "NODO",
                "reference": ref,
                "tipo": n.get("type"),
                "gps_lat": gps_lat,
                "gps_lon": gps_lon,
                "meta": {
                    "reference": ref,
                    "tipo": n.get("type"),
                    "gps_lat": gps_lat,
                    "gps_lon": gps_lon,
                    "nodo_code": n.get("code"),
                },
                "x": float(x),
                "y": float(y),
                "fixed": {"x": fixed_xy, "y": fixed_xy},
            }
        )

    existing_node_ids = {n["id"] for n in vis_nodes}

    # route_id -> (from_nodo_id, to_nodo_id, path_text)
    route_map: Dict[str, dict] = {}
    for r in routes_rows:
        route_map[str(r["route_id"])] = {
            "from": r["from_nodo_id"],
            "to": r["to_nodo_id"],
            "path_text": r.get("path_text"),
        }

    # route_id -> lista de mufas (id, code)
    route_mufas: Dict[str, List[Tuple[str, str]]] = defaultdict(list)
    for rm in route_mufa_rows:
        rid = str(rm["route_id"])
        if rid not in route_map:
            # Ruta física que no está en el summary de backbone (poco probable, pero robustez)
            continue
        mid = str(rm["mufa_id"])
        mcode = rm.get("mufa_code") or mid
        # evitamos duplicados por ruta+mufa
        if not any(m[0] == mid for m in route_mufas[rid]):
            route_mufas[rid].append((mid, mcode))

    # (from_nodo_id, mufa_id) -> set(to_nodo_id)
    from_mufa_to_dests: Dict[Tuple[str, str], set] = defaultdict(set)
    # (from_nodo_id, mufa_id) -> lista de route_ids que pasan por esa mufa
    from_mufa_to_routes: Dict[Tuple[str, str], List[str]] = defaultdict(list)
    # mufa_id -> code (para labels)
    mufa_code_map: Dict[str, str] = {}

    for rid, info in route_map.items():
        from_id = info["from"]
        to_id = info["to"]
        mufas_this_route = route_mufas.get(rid, [])
        for mufa_id, mufa_code in mufas_this_route:
            key = (from_id, mufa_id)
            from_mufa_to_dests[key].add(to_id)
            if rid not in from_mufa_to_routes[key]:
                from_mufa_to_routes[key].append(rid)
            if mufa_id not in mufa_code_map:
                mufa_code_map[mufa_id] = mufa_code

    # Determinamos qué (from_nodo, mufa) son realmente splitters:
    #   - si tiene 2+ destinos distintos, es splitter
    splitter_keys = {
        key for key, dests in from_mufa_to_dests.items() if len(dests) >= 2
    }

    # Rutas que están en algún grupo con split
    routes_in_split: set = set()
    for key in splitter_keys:
        for rid in from_mufa_to_routes[key]:
            routes_in_split.add(rid)

    # Conjunto de todas las rutas
    all_route_ids = set(route_map.keys())
    # Rutas normales = no participan en splits
    normal_route_ids = all_route_ids - routes_in_split

    # CONSTRUCCIÓN DE ARISTAS PARA vis-network
    vis_edges: List[dict] = []

    # 1) Rutas normales: NODO -> NODO directo
    for rid in sorted(normal_route_ids):
        info = route_map[rid]
        vis_edges.append(
            {
                "id": rid,
                "from": info["from"],
                "to": info["to"],
                "title": info.get("path_text"),
                "edge_kind": "NODO_LINK",
                "meta": {"route_id": rid},
            }
        )

    # 2) Rutas con MUFA_SPLIT
    # Organizamos las mufas alrededor del nodo origen
    per_from_counter: Dict[str, int] = defaultdict(int)

    for from_id, mufa_id in splitter_keys:
        # rutas que usan este splitter
        rids = from_mufa_to_routes[(from_id, mufa_id)]
        dests = {route_map[rid]["to"] for rid in rids}

        # Nodo MUFA virtual por (from_nodo, mufa)
        mufa_node_id = f"MUFA_OV_{from_id}_{mufa_id}"
        if mufa_node_id not in existing_node_ids:
            idx_for_from = per_from_counter[from_id]
            per_from_counter[from_id] += 1

            # Buscamos la posición del nodo origen para colocar la mufa cerca
            base_node = next((n for n in vis_nodes if n["id"] == from_id), None)
            if base_node is not None:
                bx, by = float(base_node["x"]), float(base_node["y"])
                sx = bx + 140.0
                sy = by - 90.0 * idx_for_from
                fixed_xy = base_node.get("fixed", {"x": True, "y": True})
            else:
                # fallback circular si no encontramos el nodo
                a = _angle_from_id(mufa_node_id)
                sx, sy = R * cos(a), R * sin(a)
                fixed_xy = {"x": True, "y": True}

            label = mufa_code_map.get(mufa_id, mufa_id)

            vis_nodes.append(
                {
                    "id": mufa_node_id,
                    "label": label,
                    "group": "mufa_split",
                    "kind": "MUFA_SPLIT",
                    "x": float(sx),
                    "y": float(sy),
                    "fixed": fixed_xy,
                    "meta": {
                        "tipo": "MUFA_SPLIT",
                        "mufa_id": mufa_id,
                        "mufa_code": label,
                        "from_nodo_id": from_id,
                        "source": "overview",
                    },
                }
            )
            existing_node_ids.add(mufa_node_id)

        # Edge único desde el nodo origen hacia la mufa
        vis_edges.append(
            {
                "id": f"{from_id}::{mufa_id}::FROM",
                "from": from_id,
                "to": mufa_node_id,
                "title": f"Split via MUFA {mufa_id}",
                "edge_kind": "NODO_TO_MUFA",
                "meta": {
                    "mufa_id": mufa_id,
                    "from_nodo_id": from_id,
                    "route_ids": rids,
                },
            }
        )

        # Edges desde la mufa hacia cada destino (uno por route_id, conservando route_id)
        for rid in rids:
            to_id = route_map[rid]["to"]
            vis_edges.append(
                {
                    "id": f"{mufa_id}::{from_id}::{to_id}::{rid}",
                    "from": mufa_node_id,
                    "to": to_id,
                    "title": route_map[rid].get("path_text"),
                    "edge_kind": "MUFA_TO_NODO",
                    "meta": {"route_id": rid},
                }
            )

    return {
        "nodes": vis_nodes,
        "edges": vis_edges,
        "meta": {
            "generated_at": datetime.utcnow().isoformat() + "Z",
            "source": "overview:nodos+backbone",
        },
    }
