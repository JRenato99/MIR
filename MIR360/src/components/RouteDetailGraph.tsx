import { useEffect, useRef, useState, useMemo } from "react";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";
import api from "../api/client";
import type { SelectionPayload } from "../types";

type RouteNode = {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  fixed?: { x: boolean; y: boolean };
  group: string;
  meta?: Record<string, unknown>;
};

type RouteEdge = {
  id: string;
  from: string;
  to: string;
  title?: string;
  group: string;
  meta?: Record<string, unknown>;
};

type RouteGraph = {
  nodes?: RouteNode[];
  edges?: RouteEdge[];
};

type RouteInventory = {
  span_count?: number;
  total_length_m?: number;
  pole_count?: number;
  mufa_count?: number;
  cables?: string[];
};

type routeDetailGraphProps = {
  route: { id: string } | null;
  onSelect?: (payload: SelectionPayload | null) => void;
};

type NetworkNodeUpdate = {
  id: string;
  fixed: { x: boolean; y: boolean };
};

type NetworkNodeUpdater = {
  update: (items: NetworkNodeUpdate[]) => void;
};

type NetworkWithData = Network & {
  body: {
    data: {
      nodes: NetworkNodeUpdater & { get: (id: string) => RouteNode };
      edges: { get: (id: string) => RouteEdge };
    };
  };
};

const nf = new Intl.NumberFormat();

export default function RouteDetailGraph({ route, onSelect }: routeDetailGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);

  const [graph, setGraph] = useState<RouteGraph>({ nodes: [], edges: [] });
  const [inventory, setInventory] = useState<RouteInventory | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [locked, setLocked] = useState(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);

  useEffect(() => {
    if (!route?.id) return;
    const loadRoute = async () => {
      setLoading(true);
      setErrMsg("");
      setSelectedEdgeId(null);
      setSelectedNodeId(null);

    try {
        const [g, inv] = await Promise.all([
          api.get(`/topology/routes/${route.id}/graph-with-access`),
          api.get(`/topology/routes/${route.id}/inventory`),
        ]);
        setGraph(g.data || { nodes: [], edges: [] });
        setInventory(inv.data || null);
      } catch (e) {
        console.error("RouteDetailGraph load error:", e);
         const message =
          (e as { response?: { data?: { detail?: string } }; message?: string })
            ?.response?.data?.detail ||
          (e as { message?: string })?.message ||
          "No se pudo cargar la ruta.";
        setErrMsg(message);
      } finally {
        setLoading(false);
      }
    };

    loadRoute();
  }, [route?.id]);

  const options = useMemo(
    () => ({
      physics: { enabled: false },
      nodes: { font: { color: "#e5e7eb" } },
      //edges: { smooth: { type: "continuous" }, color: "#94a3b8", width: 2 },
      edges: { smooth: { enabled: true, type: "continuous", roundness: 0.5 }, color: "#94a3b8", width: 2 },
      groups: {
        odf: { shape: "box", color: "#22d3ee" },
        pole: { shape: "dot", color: "#a5b4fc" },
        mufa: { shape: "diamond", color: "#f472b6" },
        router: { shape: "box", color: "#111111" },
        span: { color: "#94a3b8" },
        odf_link: { dashes: true, color: "#22d3ee" },
        pole_mufa: { dashes: true, color: "#f472b6" },
        patch: { color: "#111111" },
      },
      interaction: {
        hover: true,
        dragNodes: true,
        dragView: true,
        zoomView: true,
      },
    }),
    []
  );

  const colorForEdgeGroup = (g?: string) =>
    g === "odf_link"
      ? "#22d3ee"
      : g === "pole_mufa"
      ? "#f472b6"
      : g === "patch"
      ? "#111111"
      : "#94a3b8";
  const dashesForEdgeGroup = (g?: string) => g === "odf_link" || g === "pole_mufa";

  const styledData = useMemo(() => {
    const SEL_RED = "#ff3b30";
    const SEL_BORDER = "#b91c1c";

    const nodes = (graph.nodes || []).map((n) => {
      const base = {
        id: n.id,
        label: n.label ?? n.id,
        x: n.x,
        y: n.y,
        fixed: n.fixed ?? { x: true, y: true },
        group: n.group,
        meta: n.meta || null,
      };
      if (n.id === selectedNodeId) {
        return {
          ...base,
          color: { background: SEL_RED, border: SEL_BORDER },
        };
      }
      return base;
    });

    const edges = (graph.edges || []).map((e) => {
      const isSel = e.id === selectedEdgeId;

      return {
        id: e.id,
        from: e.from,
        to: e.to,
        title: e.title ?? "",
        color: isSel ? SEL_RED : colorForEdgeGroup(e.group),
        dashes: isSel ? false : dashesForEdgeGroup(e.group),
        width: isSel ? 3 : 2,
        group: e.group || "edge",
        meta: e.meta || null,
      };
    });
    return { nodes, edges };
  }, [graph, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!networkRef.current) {
      networkRef.current = new Network(
        containerRef.current,
        styledData,
        options
      );
      networkRef.current.once("afterDrawing", () => {
        try {
          networkRef.current?.fit({ animation: { duration: 400 , easingFunction: "easeInOutQuad"}});
        } catch {
          //noop
        }
      });
    } else {
      networkRef.current.setData(styledData);
      try {
        networkRef.current.redraw();
      } catch {
        // noop
      }
    }
  }, [styledData, options]);

  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const handlerClick = (params: { nodes?: string[]; edges?: string[] }) => {
      const network = net as NetworkWithData;
      const dsNodes = network.body.data.nodes;
      const dsEdges = network.body.data.edges;

      const nodeId = params?.nodes?.[0] || null;
      const edgeId = params?.edges?.[0] || null;

      if (!nodeId && !edgeId) return;

      const payload: SelectionPayload = { node: null, edge: null, pinned: null };

      // Notificar al DetailPanel
      if (nodeId) {
        const n = dsNodes.get(nodeId);
        payload.node = {
          id: n.id,
          kind: n.group?.toUpperCase() || "NODE",
          label: n.label,
          meta: n.meta || null,
        };
      } else if (edgeId) {
        const e = dsEdges.get(edgeId);
        payload.edge = {
          id: e.id,
          edge_kind: e.group || "EDGE",
          from: e.from,
          to: e.to,
          title: e.title ?? "",
          meta: e.meta || null,
        };
      }

      // Si esta en modo seleccion resalta uno y apaga el modo
      if (selectMode) {
        if (nodeId) {
          setSelectedNodeId(nodeId);
          setSelectedEdgeId(null);
          payload.pinned = { type: "node", id: nodeId };
        } else if (edgeId) {
          setSelectedEdgeId(edgeId);
          setSelectedNodeId(null);
          payload.pinned = { type: "edge", id: edgeId };
        }
        setSelectMode(false);
      }
      console.log(payload.pinned);
      onSelect?.(payload);
    };
    net.on("click", handlerClick);
    return () => {
      net.off("click", handlerClick);
    };
  }, [selectMode, onSelect]);

  // Drag temporal : debloquear y refijar + guardar
  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const onDragStart = (params: { nodes?: string[] }) => {
      if (locked) return;
      const ids = params?.nodes ?? [];
      if (!ids.length) return;
      try {
        const network = net as NetworkWithData;
        network.body.data.nodes.update(
          ids.map((id) => ({ id, fixed: { x: false, y: false } }))
        );
      } catch (e) {
        console.error("onDragStart update error:", e);
      }
    };

    const onDragEnd = async (params: { nodes?: string[] }) => {
      const ids = params?.nodes ?? [];
      if (!ids.length) return;
      try {
        const posMap = net.getPositions(ids);
        const items = Object.entries(posMap).map(([node_id, p]) => ({
          node_id,
          x: p.x,
          y: p.y,
        }));
        await api.post("/graph/positions", items);
        const network = net as NetworkWithData;
        network.body.data.nodes.update(
          ids.map((id) => ({ id, fixed: { x: true, y: true } }))
        );
      } catch (e) {
        console.error("onDragEnd persist/fix error:", e);
      }
    };

    net.on("dragStart", onDragStart);
    net.on("dragEnd", onDragEnd);
    return () => {
      net.off("dragStart", onDragStart);
      net.off("dragEnd", onDragEnd);
    };
  }, [locked]);

  //Guardar Todo
  const saveAllPositions = async () => {
    const net = networkRef.current;
    if (!net) return;
    try {
      const pos = net.getPositions();
      const items = Object.entries(pos).map(([node_id, p]) => ({
        node_id,
        x: p.x,
        y: p.y,
      }));
      await api.post("/graph/positions", items);
      alert("Posiciones de la ruta guardadas.");
    } catch (e) {
      console.error("Guardar posiciones error:", e);
      alert("No se pudo guardar posiciones.");
    }
  };

  const clearSelection = () => {
    setSelectedEdgeId(null);
    setSelectedNodeId(null);
    onSelect?.(null);
  };

  return (
    <>
      <div
        className="graph-container"
        ref={containerRef}
        style={{
          width: "100%",
          height: "90vh",
          borderRadius: 8,
          border: "1px solid #1f2937",
        }}
      />

      {!!errMsg && (
        <div
          style={{
            position: "absolute",
            left: 16,
            top: 16,
            padding: 8,
            borderRadius: 8,
            background: "#2a0f10",
            color: "#ffb4b4",
            border: "1px solid #5f1e21",
            whiteSpace: "pre-wrap",
            maxWidth: 480,
          }}
        >
          {String(errMsg)}
        </div>
      )}

      <div style={{ position: "absolute", left: 16, bottom: 16 }}>
        <div className="card" style={{ minWidth: 320 }}>
          <b>Ruta:</b> {route?.id ?? "-"}
          <br />
          {inventory && (
            <>
              <hr style={{ borderColor: "#374151", margin: "10px 0" }} />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div>
                  <b>Spans</b>
                  <div>{inventory.span_count}</div>
                </div>
                <div>
                  <b>Longitud</b>
                  <div>
                    {nf.format(Math.round(inventory.total_length_m || 0))} m
                  </div>
                </div>
                <div>
                  <b>Postes</b>
                  <div>{inventory.pole_count}</div>
                </div>
                <div>
                  <b>Mufas</b>
                  <div>{inventory.mufa_count}</div>
                </div>
              </div>

              {inventory.cables?.length ? (
                <div style={{ marginTop: 8 }}>
                  <b>Cables:</b> {inventory.cables.join(", ")}
                </div>
              ) : null}
            </>
          )}
          {loading && (
            <div style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}>
              Cargando…
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <button
          className={`btn ${selectMode ? "accent" : ""}`}
          onClick={() => setSelectMode((v) => !v)}
          title={
            selectMode
              ? "Modo selección ACTIVO: clic para resaltar y salir del modo"
              : "Activar modo selección para resaltar"
          }
        >
          {selectMode ? "🎯 Selección ON" : "Seleccionar elemento"}
        </button>
        <button
          className={`btn ${locked ? "accent" : ""}`}
          onClick={() => setLocked((v) => !v)}
          title={
            locked
              ? "Desbloquear para permitir arrastre"
              : "Bloquear para impedir arrastre"
          }
        >
          {locked ? "🔒 Bloqueado" : "🔓 Desbloqueado"}
        </button>

        <button className="btn" onClick={() => networkRef.current?.fit()}>
          Centrar
        </button>
        <button className="btn" onClick={saveAllPositions} disabled={loading}>
          Guardar posiciones
        </button>

        {/* Quitar seleccion */}
        <button className="btn" onClick={clearSelection}>
          Limpiar Selección
        </button>
      </div>
    </>
  );
}
