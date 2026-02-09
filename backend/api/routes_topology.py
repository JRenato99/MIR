from fastapi import APIRouter, HTTPException
from core.db import fetch_all
from typing import List, Dict

router = APIRouter(prefix="/topology", tags=["topology"])


# Lee posiciones grabadas
def get_position_map(node_ids: List[str]) -> Dict[str, tuple[float, float]]:
    if not node_ids:
        return {}
    q = """
        SELECT node_id, x, y
        FROM dbo.graph_node_position
        WHERE node_id IN ({})
    """.format(
        ",".join([f":id{i}" for i in range(len(node_ids))])
    )
    params = {f"id{i}": nid for i, nid in enumerate(node_ids)}
    try:
        rows = fetch_all(q, **params)
        return {r["node_id"]: (r["x"], r["y"]) for r in rows}
    except Exception:
        return {}


# Listar rutas logicas(ODF-ODF) + resumen fisico
@router.get("/routes")
def list_routes():
    sql = """
    SELECT r.id,
        r.from_odf_id,
        r.to_odf_id,
        o1.nodo_id as from_nodo_id,
        o2.nodo_id as to_nodo_id,
        ps.span_list,
        r.path_text
    FROM dbo.odf_route r
    JOIN dbo.odf o1 on o1.id = r.from_odf_id
    JOIN dbo.odf o2 on o2.id = r.to_odf_id
    LEFT JOIN dbo.vw_route_physical_summary ps ON ps.odf_route_id = r.id
    ORDER BY r.id
    """
    try:
        return fetch_all(sql)
    except Exception as e:
        raise HTTPException(500, f"DB_ERROR_LIST_ROUTES: {e}")


# Grafo detallado por ruta (ODF, poste, mufas, segmentos/spans)
@router.get("/routes/{route_id}/graph")
def route_graph(route_id: str):
    """
    Grafo físico de la ruta, extendido para incluir ramales que COMPARTEN spans
    con la ruta base y salen del mismo nodo origen.

    Ejemplo:
        NODO A -> ... -> MUFA X -> ... -> NODO B
        NODO A -> ... -> MUFA X -> ... -> NODO C

    Si la ruta base es A-B, el grafo incluirá también el ramal hacia C.
    Y si la base es A-C, incluirá el ramal hacia B.
    """

    # 1) Datos de la ruta base (extremos)
    ends_rows = fetch_all(
        """
        SELECT r.id as route_id, r.from_odf_id, r.to_odf_id,
               o1.name as from_odf_name, o1.code as from_odf_code, o1.nodo_id as from_nodo_id,
               o2.name as to_odf_name, o2.code as to_odf_code, o2.nodo_id as to_nodo_id
        FROM dbo.odf_route r
        JOIN dbo.odf o1 on o1.id = r.from_odf_id
        JOIN dbo.odf o2 on o2.id = r.to_odf_id
        WHERE r.id = :rid
        """,
        rid=route_id,
    )
    if not ends_rows:
        raise HTTPException(status_code=404, detail=f"ROUTE_NOT_FOUND: {route_id}")
    base_end = ends_rows[0]
    base_from_nodo_id = base_end["from_nodo_id"]

    # 2) Rutas "hermanas": mismas spans físicos + mismo nodo origen
    related_rows = fetch_all(
        """
        WITH base_spans AS (
            SELECT DISTINCT ors.cable_span_id
            FROM dbo.odf_route_segment ors
            WHERE ors.odf_route_id = :rid
        )
        SELECT DISTINCT r2.id AS route_id
        FROM base_spans bs
        JOIN dbo.odf_route_segment ors2
            ON ors2.cable_span_id = bs.cable_span_id
        JOIN dbo.odf_route r2
            ON r2.id = ors2.odf_route_id
        JOIN dbo.odf o_from2
            ON o_from2.id = r2.from_odf_id
        WHERE r2.id <> :rid
          AND o_from2.nodo_id = :from_nodo_id
        """,
        rid=route_id,
        from_nodo_id=base_from_nodo_id,
    )

    related_ids = [r["route_id"] for r in related_rows] if related_rows else []
    all_route_ids: List[str] = [route_id] + related_ids

    # 3) Spans físicos de TODAS las rutas involucradas
    #    (base + hermanas)
    placeholders = ",".join(f":r{i}" for i in range(len(all_route_ids)))
    params_routes = {f"r{i}": rid for i, rid in enumerate(all_route_ids)}

    segs = fetch_all(
        f"""
        SELECT odf_route_id, seg_seq, cable_span_id, cable_id, cable_seq,
               from_pole_id, from_pole_code, to_pole_id, to_pole_code,
               length_m, length_span, capacity_fibers
        FROM dbo.vw_route_segments_expanded
        WHERE odf_route_id IN ({placeholders})
        ORDER BY odf_route_id, seg_seq
        """,
        **params_routes,
    )
    if not segs:
        raise HTTPException(
            status_code=404,
            detail=f"ROUTE_NOT_FOUND_OR_EMPTY_GROUP: {route_id}",
        )

    # 4) Extremos ODF de TODAS las rutas (para poder dibujar B, C, etc.)
    ends_all_rows = fetch_all(
        f"""
        SELECT r.id as route_id, r.from_odf_id, r.to_odf_id,
               o1.name as from_odf_name, o1.code as from_odf_code, o1.nodo_id as from_nodo_id,
               o2.name as to_odf_name, o2.code as to_odf_code, o2.nodo_id as to_nodo_id
        FROM dbo.odf_route r
        JOIN dbo.odf o1 on o1.id = r.from_odf_id
        JOIN dbo.odf o2 on o2.id = r.to_odf_id
        WHERE r.id IN ({placeholders})
        """,
        **params_routes,
    )
    route_end_map = {r["route_id"]: r for r in ends_all_rows}

    # 5) Postes ordenados y último poste por ruta (para conectar cada ODF destino)
    ordered_poles: List[str] = []
    last_pole_by_route: Dict[str, str] = {}

    for s in segs:
        fp = s["from_pole_id"]
        tp = s["to_pole_id"]
        if fp not in ordered_poles:
            ordered_poles.append(fp)
        if tp not in ordered_poles:
            ordered_poles.append(tp)
        # último poste donde termina la ruta
        last_pole_by_route[s["odf_route_id"]] = tp

    # 6) Datos de postes
    poles = []
    if ordered_poles:
        q_poles = """
            SELECT id, code, gps_lat, gps_lon, pole_type, status
            FROM dbo.pole
            WHERE id IN ({})
        """.format(
            ",".join(f":p{i}" for i in range(len(ordered_poles)))
        )
        params_poles = {f"p{i}": pid for i, pid in enumerate(ordered_poles)}
        poles = fetch_all(q_poles, **params_poles)
    pole_map = {p["id"]: p for p in poles}

    # 7) Mufas por poste
    mufas = []
    if ordered_poles:
        q_mufas = """
            SELECT id, code, pole_id, mufa_type, gps_lat, gps_lon
            FROM dbo.mufa
            WHERE pole_id IN ({})
        """.format(
            ",".join(f":m{i}" for i in range(len(ordered_poles)))
        )
        params_mufas = {f"m{i}": pid for i, pid in enumerate(ordered_poles)}
        mufas = fetch_all(q_mufas, **params_mufas)

    # 8) Construcción de nodos y aristas
    nodes = []
    edges = []

    def nid(kind: str, raw_id: str) -> str:
        # para este grafo usamos el id crudo (consistente con el resto de la app)
        return f"{raw_id}"

    # 9) Posiciones guardadas
    candidate_ids: List[str] = []

    base_from_odf_id = base_end["from_odf_id"]
    from_odf_node_id = nid("ODF", base_from_odf_id)

    # Todos los ODF destino (B, C, ...) de las rutas involucradas
    to_odf_ids = set()
    for r_id, info in route_end_map.items():
        to_odf_ids.add(info["to_odf_id"])

    to_odf_node_ids = [nid("ODF", oid) for oid in to_odf_ids]

    candidate_ids.append(from_odf_node_id)
    candidate_ids.extend(to_odf_node_ids)
    candidate_ids.extend(nid("POLE", p) for p in ordered_poles)
    candidate_ids.extend(nid("MUFA", m["id"]) for m in mufas)

    pos_map = get_position_map(candidate_ids)

    # 10) Layout lineal de postes por defecto
    SPACING_X = 220.0
    for i, pid in enumerate(ordered_poles):
        k = nid("POLE", pid)
        if k not in pos_map:
            pos_map[k] = (i * SPACING_X, 0.0)

    # 11) Posición de ODF origen y ODF destino
    if ordered_poles:
        x0 = pos_map[nid("POLE", ordered_poles[0])][0]
        xN = pos_map[nid("POLE", ordered_poles[-1])][0]
    else:
        x0, xN = -180.0, 180.0

    if from_odf_node_id not in pos_map:
        pos_map[from_odf_node_id] = (x0 - 180.0, 0.0)

    # default X para cada ODF destino, basado en el último poste de su ruta
    default_to_pos: Dict[str, tuple[float, float]] = {}
    for r_id, info in route_end_map.items():
        to_oid = info["to_odf_id"]
        last_pole = last_pole_by_route.get(r_id)
        if not last_pole:
            continue
        pole_k = nid("POLE", last_pole)
        px, py = pos_map.get(pole_k, (xN, 0.0))
        default_to_pos[to_oid] = (px + 180.0, py)

    for to_oid in to_odf_ids:
        k = nid("ODF", to_oid)
        if k not in pos_map:
            px, py = default_to_pos.get(to_oid, (xN + 180.0, 0.0))
            pos_map[k] = (px, py)

    # 12) Nodos ODF
    # ODF origen (único)
    nodes.append(
        {
            "id": from_odf_node_id,
            "label": base_end["from_odf_code"]
            or base_end["from_odf_name"]
            or base_from_odf_id,
            "group": "odf",
            "x": float(pos_map[from_odf_node_id][0]),
            "y": float(pos_map[from_odf_node_id][1]),
            "fixed": {"x": True, "y": True},
            "meta": {
                "nodo_id": base_end["from_nodo_id"],
                "odf_id": base_from_odf_id,
            },
        }
    )

    # ODF destino (pueden ser varios: B, C, ...)
    # Tomamos la info de cualquier ruta que tenga ese to_odf_id
    to_odf_info: Dict[str, dict] = {}
    for r_id, info in route_end_map.items():
        to_oid = info["to_odf_id"]
        if to_oid not in to_odf_info:
            to_odf_info[to_oid] = info

    for to_oid, info in to_odf_info.items():
        k = nid("ODF", to_oid)
        nodes.append(
            {
                "id": k,
                "label": info["to_odf_code"] or info["to_odf_name"] or to_oid,
                "group": "odf",
                "x": float(pos_map[k][0]),
                "y": float(pos_map[k][1]),
                "fixed": {"x": True, "y": True},
                "meta": {
                    "nodo_id": info["to_nodo_id"],
                    "odf_id": to_oid,
                },
            }
        )

    # 13) Nodos de postes
    for pid in ordered_poles:
        p = pole_map.get(pid, {"code": pid})
        k = nid("POLE", pid)
        nodes.append(
            {
                "id": k,
                "label": p.get("code") or pid,
                "group": "pole",
                "x": float(pos_map[k][0]),
                "y": float(pos_map[k][1]),
                "fixed": {"x": True, "y": True},
                "meta": {
                    "pole_id": pid,
                    "pole_type": p.get("pole_type"),
                    "status": p.get("status"),
                    "gps_lat": p.get("gps_lat"),
                    "gps_lon": p.get("gps_lon"),
                },
            }
        )

    # 14) Nodos de MUFAS (sobre postes)
    MUFA_DY = -120.0

    for m in mufas:
        k = nid("MUFA", m["id"])
        if k not in pos_map:
            px, py = pos_map[nid("POLE", m["pole_id"])]
            pos_map[k] = (px, py + MUFA_DY)
        nodes.append(
            {
                "id": k,
                "label": m["code"],
                "group": "mufa",
                "x": float(pos_map[k][0]),
                "y": float(pos_map[k][1]),
                "fixed": {"x": True, "y": True},
                "meta": {
                    "mufa_id": m["id"],
                    "pole_id": m["pole_id"],
                    "mufa_type": m.get("mufa_type"),
                    "gps_lat": m.get("gps_lat"),
                    "gps_lon": m.get("gps_lon"),
                },
            }
        )

        # Arista poste-mufa (decorativa)
        edges.append(
            {
                "id": f"PM:{m['pole_id']}:{m['id']}",
                "from": nid("POLE", m["pole_id"]),
                "to": k,
                "group": "pole_mufa",
                "title": "Mufa",
            }
        )

    # 15) Aristas de spans (poste a poste), para todas las rutas
    for s in segs:
        edges.append(
            {
                "id": f"{s['cable_span_id']}",
                "from": nid("POLE", s["from_pole_id"]),
                "to": nid("POLE", s["to_pole_id"]),
                "group": "span",
                "title": (
                    f"{s['cable_id']} | {s['capacity_fibers']} hilos | "
                    f"{s['length_m'] or 0}m / {s['length_span'] or 0}m"
                ),
                "meta": {
                    "cable_id": s["cable_id"],
                    "cable_seg_id": s["cable_span_id"],
                    "length_m": s["length_m"],
                    "seg_seq": s["seg_seq"],
                    "capacity_span": s["length_span"],
                    "capacity_fibers": s["capacity_fibers"],
                    "odf_route_id": s["odf_route_id"],
                },
            }
        )

    # 16) Arista "virtual" ODF origen -> primer poste
    if ordered_poles:
        edges.append(
            {
                "id": f"ODF_IN:{route_id}",
                "from": from_odf_node_id,
                "to": nid("POLE", ordered_poles[0]),
                "group": "odf_link",
                "title": "Entrada a planta externa",
            }
        )

    # 17) Aristas "virtuales" último poste de cada ruta -> su ODF destino
    for r_id, info in route_end_map.items():
        last_pole = last_pole_by_route.get(r_id)
        if not last_pole:
            continue
        to_oid = info["to_odf_id"]
        edges.append(
            {
                "id": f"ODF_OUT:{r_id}",
                "from": nid("POLE", last_pole),
                "to": nid("ODF", to_oid),
                "group": "odf_link",
                "title": f"Salida a ODF destino (ruta {r_id})",
            }
        )

    return {"nodes": nodes, "edges": edges}


# INVENTARIO / KPIS DE LA RUTA
@router.get("/routes/{route_id}/inventory")
def route_inventory(route_id: str):
    # spans
    spans = fetch_all(
        """
        SELECT e.cable_span_id, e.cable_id, e.seg_seq, cs.length_m
        FROM dbo.vw_route_segments_expanded e
        JOIN dbo.cable_span cs ON cs.id = e.cable_span_id
        WHERE e.odf_route_id = :rid
        ORDER BY e.seg_seq
    """,
        rid=route_id,
    )

    # Recolecta postes reales
    poles_real = fetch_all(
        """
    SELECT DISTINCT cs.from_pole_id as pole_id FROM dbo.vw_route_segments_expanded e
    JOIN dbo.cable_span cs ON cs.id = e.cable_span_id
    WHERE e.odf_route_id = :rid
    UNION
    SELECT DISTINCT cs.to_pole_id FROM dbo.vw_route_segments_expanded e
    JOIN dbo.cable_span cs ON cs.id = e.cable_span_id
    WHERE e.odf_route_id = :rid
    """,
        rid=route_id,
    )
    pole_ids = [r["pole_id"] for r in poles_real] if poles_real else []

    mufa_count = 0
    if pole_ids:
        q = """
        SELECT COUNT(*) AS c
        FROM dbo.mufa
        WHERE pole_id IN ({})
        """.format(
            ",".join([f":p{i}" for i in range(len(pole_ids))])
        )
        params = {f"p{i}": pid for i, pid in enumerate(pole_ids)}
        mufa_count = fetch_all(q, **params)[0]["c"]

    total_len = sum((s["length_m"] or 0.0) for s in spans)
    cable_set = sorted({s["cable_id"] for s in spans})

    return {
        "route_id": route_id,
        "spans": spans,
        "cables": cable_set,
        "span_count": len(spans),
        "total_length_m": total_len,
        "pole_count": len(pole_ids),
        "mufa_count": int(mufa_count),
    }


@router.get("/routes/{route_id}/graph-with-access")
def route_graph_with_access(route_id: str):
    base = route_graph(route_id)
    nodes = {n["id"]: n for n in base["nodes"]}
    edges = {e["id"]: e for e in base["edges"]}

    # Extremos ODF de la ruta
    ends = fetch_all(
        """
            SELECT r.id as route_id, r.from_odf_id, r.to_odf_id,
                        o1.name as from_odf_name, o1.code as from_odf_code, o1.nodo_id as from_nodo_id,
                        o2.name as to_odf_name, o2.code as to_odf_code, o2.nodo_id as to_nodo_id
            FROM dbo.odf_route r
            JOIN dbo.odf o1 on o1.id = r.from_odf_id
            JOIN dbo.odf o2 on o2.id = r.to_odf_id
            WHERE r.id = :rid
        """,
        rid=route_id,
    )
    if not ends:
        raise HTTPException(404, f"ROUTE_NOT_FOUND: {route_id}")
    ends = ends[0]

    lks = fetch_all(
        """
            SELECT link_id, router_id, router_name, router_nodo_id, router_port_id,
                        odf_id, odf_name, odf_nodo_id, odf_port_id
            FROM dbo.vw_router_odf_link
            WHERE odf_id IN (:a, :b)
        """,
        a=ends["from_odf_id"],
        b=ends["to_odf_id"],
    )

    # Posiciones Guardadas
    def nid(kind: str, raw: str) -> str:
        return f"{raw}"

    pos_rows = fetch_all("SELECT node_id, x, y FROM dbo.graph_node_position")
    pos_map = {r["node_id"]: (r["x"], r["y"]) for r in pos_rows}

    # Crear nodos y edges
    DX_ROUTER = 0.0
    DY_ROUTER = 120.0

    for lk in lks:
        odf_node_id = nid("ODF", lk["odf_id"])
        if odf_node_id not in nodes:
            continue

        odf_x = nodes[odf_node_id]["x"]
        odf_y = nodes[odf_node_id]["y"]

        router_node_id = nid("RTR", lk["router_id"])
        if router_node_id not in nodes:
            rx, ry = pos_map.get(router_node_id, (odf_x + DX_ROUTER, odf_y + DY_ROUTER))
            nodes[router_node_id] = {
                "id": router_node_id,
                "label": lk["router_name"] or lk["router_id"],
                "group": "router",
                "x": float(rx),
                "y": float(ry),
                "fixed": {"x": True, "y": True},
                "meta": {
                    "router_id": lk["router_id"],
                    "nodo_id": lk["router_nodo_id"],
                },
            }

        e_id = f"PATCH:{lk['link_id']}"
        if e_id not in edges:
            edges[e_id] = {
                "id": e_id,
                "from": router_node_id,
                "to": odf_node_id,
                "group": "patch",
                "title": f"Link {lk['link_id']} \nRPort={lk['router_port_id']} -> OPort={lk['odf_port_id']}",
                "meta": {
                    "router_port_id": lk["router_port_id"],
                    "odf_port_id": lk["odf_port_id"],
                },
            }

    return {"nodes": list(nodes.values()), "edges": list(edges.values())}


@router.get("/nodes/{nodo_id}/details")
def node_details(nodo_id: str):
    try:
        nodo = fetch_all(
            """
            SELECT id, code, name, reference, gps_lat, gps_lon
            FROM dbo.nodo
            WHERE id = :nid
        """,
            nid=nodo_id,
        )
        if not nodo:
            raise HTTPException(404, f"NODO_NOT_FOUND: {nodo_id}")
        nodo = nodo[0]

        routers = fetch_all(
            """
            SELECT id, name, model, mgmt_ip
            FROM dbo.router
            WHERE nodo_id = :nid
            ORDER BY name
        """,
            nid=nodo_id,
        )

        odfs = fetch_all(
            """
            SELECT id, code, name, total_ports
            FROM dbo.odf
            WHERE nodo_id = :nid
            ORDER BY code
        """,
            nid=nodo_id,
        )

        # Rutas relacionadas (desde backbone edges)
        routes = fetch_all(
            """
            SELECT DISTINCT route_id AS id, path_text
            FROM dbo.vw_backbone_edges
            WHERE from_nodo_id = :nid OR to_nodo_id = :nid
            ORDER BY route_id
        """,
            nid=nodo_id,
        )

        return {
            "nodo": nodo,
            "routers": routers,
            "odfs": odfs,
            "routes": routes,
        }
    except Exception as e:
        raise HTTPException(500, f"DB_ERROR_NODE_DETAILS: {e}")


@router.get("/poles/{pole_id}/details")
def get_pole_details(pole_id: str):

    try:
        # Datos del Poste

        pole_rows = fetch_all(
            """
                SELECT p.*
                FROM dbo.pole p
                WHERE p.id = :nid
            """,
            nid=pole_id,
        )

        if not pole_rows:
            raise HTTPException(status_code=404, detail=f"POLE_NOT_FOUND: {pole_id}")
        pole = pole_id

        # Mufas en postes con # splices por mufa
        mufas = fetch_all(
            """
                SELECT m.*,
                    (SELECT COUNT(*) FROM dbo.splice s WHERE s.mufa_id = m.id) AS splice_count
                FROM dbo.mufa m
                WHERE m.pole_id = :nid
            """,
            nid=pole_id,
        )

        # Spans conectados en este poste
        spans = fetch_all(
            """
                SELECT s.*,
                    c.code as cable_code,
                    c.fiber_count,
                    c.material_type,
                    c.jacket_type
                FROM dbo.cable_span s
                JOIN dbo.cable c on c.id = s.cable_id
                WHERE s.from_pole_id = :nid OR s.to_pole_id = :nid
                ORDER BY s.cable_id, s.seq
            """,
            nid=pole_id,
        )

        # Cables que pasan por este poste
        cables = fetch_all(
            """
                SELECT DISTINCT c.id, c.code, c.fiber_count, c.material_type, c.jacket_type
                FROM dbo.cable_span s
                JOIN dbo.cable c on c.id = s.cable_id
                WHERE s.from_pole_id = :nid OR s.to_pole_id = :nid
                ORDER BY c.code
            """,
            nid=pole_id,
        )

        # Postes vecinos
        neighbors = fetch_all(
            """
                SELECT 
                    CASE WHEN s.from_pole_id = :nid THEN s.to_pole_id ELSE s.from_pole_id END AS neighbor_pole_id,
                    p.code AS neighbor_pole_code,
                    s.id AS via_span_id,
                    s.length_m
                FROM dbo.cable_span s
                JOIN dbo.pole p
                    ON p.id = CASE WHEN s.from_pole_id = :nid THEN s.to_pole_id ELSE s.from_pole_id END
                WHERE s.from_pole_id = :nid OR s.to_pole_id = :nid
                ORDER BY p.code
            """,
            nid=pole_id,
        )

        # EXTRAS
        total_spans = len(spans)
        total_length_m = (
            sum([float(s.get("length_m") or 0) for s in spans]) if spans else 0.0
        )
        return {
            "pole": pole_rows,
            "summary": {
                "mufa_count": len(mufas),
                "span_count": total_spans,
                "total_length_m": total_length_m,
                "cable_count": len(cables),
                "neighbor_count": len(neighbors),
            },
            "mufas": mufas,
            "spans": spans,
            "cables": cables,
            "neighbors": neighbors,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"POLE_DETAILS_ERROR: {e}")


@router.get("/mufas/{mufa_id}/splices")
def get_mufa_splices(mufa_id: str):
    # Mufa basica
    mufa = fetch_all(
        """
            SELECT id, code, pole_id, mufa_type, gps_lat, gps_lon
            FROM dbo.mufa
            WHERE id = :nid
        """,
        nid=mufa_id,
    )
    if not mufa:
        raise HTTPException(status_code=404, detail=f"MUFA_NOT_FOUND: {mufa_id}")

    # Empalme A <-> B (dilamento y cable de cada lado)
    rows = fetch_all(
        """
        SELECT
            s.id                AS splice_id,
            s.mufa_id,

            fa.id               AS a_fiber_filament_id,
            fa.filament_no      AS a_filament_no,
            fa.color_code       AS a_color_code,
            ca.id               AS a_cable_id,
            ca.code             AS a_cable_code,

            fb.id               AS b_fiber_filament_id,
            fb.filament_no      AS b_filament_no,
            fb.color_code       AS b_color_code,
            cb.id               AS b_cable_id,
            cb.code             AS b_cable_code

        FROM dbo.splice s
        JOIN dbo.fiber_filament fa ON fa.id = s.a_fiber_filament_id
        JOIN dbo.cable          ca ON ca.id = fa.cable_id
        JOIN dbo.fiber_filament fb ON fb.id = s.b_fiber_filament_id
        JOIN dbo.cable          cb ON cb.id = fb.cable_id
        WHERE s.mufa_id = :nid
        ORDER BY ca.code, cb.code, a_filament_no, b_filament_no
        """,
        nid=mufa_id,
    )

    # Agrupamos la data
    splices = []
    groups_map = {}

    for r in rows:
        item = {
            "splice_id": r["splice_id"],
            "a": {
                "cable_id": r["a_cable_id"],
                "cable_code": r["a_cable_code"],
                "fiber_filament_id": r["a_fiber_filament_id"],
                "filament_no": r["a_filament_no"],
                "color_code": r["a_color_code"],
            },
            "b": {
                "cable_id": r["b_cable_id"],
                "cable_code": r["b_cable_code"],
                "fiber_filament_id": r["b_fiber_filament_id"],
                "filament_no": r["b_filament_no"],
                "color_code": r["b_color_code"],
            },
        }
        splices.append(item)

        key = f'{item["a"]["cable_code"]}->{item["b"]["cable_code"]}'
        groups_map.setdefault(key, 0)
        groups_map[key] += 1

    groups = [{"pair": k, "count": v} for k, v in groups_map.items()]
    groups.sort(key=lambda x: (-x["count"], x["pair"]))
    # print(mufa)
    # print(splices)
    # print(groups)
    return {
        "mufa": mufa,
        "splices": splices,
        "groups": groups,
    }
