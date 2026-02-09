import { useEffect, useState, useRef, useMemo } from "react";
import { Network } from "vis-network";
import "vis-network/styles/vis-network.css";
import api from "../api/client";
import type { SelectionPayload } from "../types";

type  GraphNode = {
  id: string;
  label?: string;
  x?: number;
  y?: number;
  fixed?: { x: boolean; y: boolean };
  kind?: string;
  group?: string;
  meta?: Record<string, unknown> | null;
  layer?: string | null;
  status?: string | null;
}

type  GraphEdge = {
  id: string;
  from: string;
  to: string;
  title?: string;
  edge_kind?: string;
  group?: string;
  meta?: Record<string, unknown> | null;
}

type GraphOverviewData = {
  nodes?: GraphNode[];
  edges?: GraphEdge[];
  meta?: Record<string, unknown>;
}

type GraphOverviewProps = {
  onSelect: (selection: SelectionPayload | null) => void;
  onOpenRoute: (routeId: string) => void;
}

function buildOptions() {
  return {
    physics: { enabled: false },
    interaction: {
      hover: true,
      tooltipDelay: 120,
      multiselect: true,
      navigationButtons: true,
      keyboard: true,
      zoomView: true,
      dragView: true,
      dragNodes: true,
    },
    nodes: { shape: "box", size: 16, font: { size: 12 } },
    edges: { smooth: false, arrows: { to: false }, width: 2 },
  };
}

export default function GraphOverview({ onSelect, onOpenRoute }: GraphOverviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const networkRef = useRef<Network | null>(null);

  // refs para tener SIEMPRE la última versión de los callbacks
  const selectCallbackRef = useRef<GraphOverviewProps["onSelect"]>(onSelect);
  const openRouteCallbackRef =
    useRef<GraphOverviewProps["onOpenRoute"]>(onOpenRoute);

  const [loading, setLoading] = useState(false);
  const [graph, setGraph] = useState<GraphOverviewData>({ 
    nodes: [], edges: [], meta: {} });
  const [locked, setLocked] = useState(false);

  // Mantener callbacks actualizados sin re-registrar eventos en vis-network
  useEffect(() => {
    selectCallbackRef.current = onSelect;
    openRouteCallbackRef.current = onOpenRoute;
  }, [onSelect, onOpenRoute]);

  // Cargar grafo overview (solo una vez)
  useEffect(() => {
    setLoading(true);
    api
      .get("/graph/overview")
      .then((r) => setGraph(r.data))
      .catch((e) => console.error("GET /graph/overview error:", e))
      .finally(() => setLoading(false));
  }, []);

  // Adaptar data del backend al formato de vis-network
  const data = useMemo(() => {
    const nodes = (graph.nodes || []).map((n) => {
      const kind = n.kind || "NODO";
      const group = n.group || "nodo";

      // Nodo MUFA_SPLIT (círculo)
      if (kind === "MUFA_SPLIT" || group === "mufa_split") {
        return {
          id: n.id,
          label: n.label ?? "",
          x: n.x,
          y: n.y,
          fixed: n.fixed ?? { x: true, y: true },
          group: "mufa_split",
          kind,
          color: { background: "#0f172a", border: "#38bdf8" },
          font: { color: "#e5e7eb", size: 8 },
          shape: "circle",
          size: 8,
          meta: n.meta || null,
          layer: n.layer ?? null,
          status: n.status ?? null,
        };
      }

      // Nodo físico (NODO)
      return {
        id: n.id,
        label: n.label ?? n.id,
        x: n.x,
        y: n.y,
        fixed: n.fixed ?? { x: true, y: true },
        group: "nodo",
        kind: "NODO",
        color: { background: "#FFEDD5", border: "#FF6A00" },
        font: { color: "#111" },
        shape: "box",
        // margin: 8, // Removed to match the expected Node type
        meta: n.meta || null,
        layer: n.layer ?? null,
        status: n.status ?? null,
      };
    });

    const edges = (graph.edges || []).map((e) => {
      const kind = e.edge_kind || e.group || "NODO_LINK";
      let color = "#94a3b8";
      let dashes = true;

      if (kind === "NODO_TO_MUFA" || kind === "MUFA_TO_NODO") {
        color = "#38bdf8";
        dashes = false;
      }

      return {
        id: e.id,
        from: e.from,
        to: e.to,
        title: e.title ?? "",
        color,
        dashes,
        width: 2,
        group: kind,
        meta: e.meta || null, // aquí esperamos meta.route_id en edges que abren RouteDetail
      };
    });

    return { nodes, edges };
  }, [graph]);

  // Crear la instancia de Network UNA sola vez y registrar eventos
  useEffect(() => {
    if (!containerRef.current) return;
    if (networkRef.current) return; // ya fue creado

    const options = buildOptions();
    networkRef.current = new Network(containerRef.current, data, options);

    // Fit inicial solo una vez
    networkRef.current.once("afterDrawing", () => {
      try {
        networkRef.current?.fit({ animation: { duration: 400, easingFunction: "easeInOutQuad" } });
      } catch (e) {
        console.error(e);
      }
    });

    // CLICK -> manda info a DetailsPanel (no resetea vista)
    networkRef.current.on("click", (params) => {
      const net = networkRef.current as Network & {
        body?: { data: { nodes: { get: (id: string) => GraphNode }; edges: { get: (id: string) => GraphEdge } } };
      };
      const dsNodes = net.body?.data.nodes;
      const dsEdges = net.body?.data.edges;
      const onSelectCb = selectCallbackRef.current;

      if (!onSelectCb || !dsNodes || !dsEdges) return;

      if (params?.nodes?.length) {
        const n = dsNodes.get(params.nodes[0]);
        onSelectCb({
          node: {
            id: n.id,
            kind: n.kind || "NODO",
            label: n.label,
            layer: n.layer ?? null,
            status: n.status ?? null,
            group: n.group,
            meta: n.meta || null,
          },
        });
        return;
      }

      if (params?.edges?.length) {
        const e = dsEdges.get(params.edges[0]);
        onSelectCb({
          edge: {
            id: e.id,
            edge_kind: e.group || "NODO_LINK",
            from: e.from,
            to: e.to,
            title: e.title ?? "",
            meta: e.meta || null,
          },
        });
        return;
      }

      onSelectCb(null);
    });

    // DOBLE CLICK:
    // - Si es sobre nodo (incluye mufa): NO hacer nada.
    // - Si es sobre edge sin meta.route_id: NO hacer nada.
    // - Si es sobre edge con meta.route_id: abrir RouteDetail.
    networkRef.current.on("doubleClick", (params) => {
      const onOpenRouteCb = openRouteCallbackRef.current;
      if (!onOpenRouteCb) return;

      // Bloquear doble clic sobre nodos (NODO físico o MUFA_SPLIT)
      if (params?.nodes && params.nodes.length > 0) {
        return;
      }

      const edgeId = params?.edges?.[0];
      if (!edgeId) return;

      const net = networkRef.current as Network & {
        body?: { data: { edges: { get: (id: string) => GraphEdge } } };
      };
      const dsEdges = net.body?.data.edges;
      const e = dsEdges?.get(edgeId);
      if (!e || !e.meta || !e.meta.route_id) {
        // Edge sin route_id (por ejemplo NODO->MUFA) => ignorar
        return;
      }

      const routeId = e.meta.route_id;
      if (typeof routeId === "string" && routeId.length > 0) {
        onOpenRouteCb(routeId);
      }
    });

    // Limpieza al desmontar
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [data]); // solo necesita data inicial para crear el grafo

  // Actualizar data del grafo SIN perder zoom/posición
  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    // Guardamos posición actual de la vista
    const currentPosition = net.getViewPosition();
    const currentScale = net.getScale();

    // Actualizamos nodos y edges
    net.setData(data);

    // Restauramos vista (sin animación) para que no "salte" de sitio
    net.moveTo({
      position: currentPosition,
      scale: currentScale,
      animation: false,
    });
  }, [data]);

  // Drag temporal: desbloquear en dragStart y re-fijar + guardar en dragEnd
  useEffect(() => {
    const net = networkRef.current;
    if (!net) return;

    const onDragStart = (params: { nodes?: string[] }) => {
      if (locked) return;
      const ids = params?.nodes ?? [];
      if (!ids.length) return;
      (net as any).body.data.nodes.update(
        ids.map((id) => ({ id, fixed: { x: false, y: false } }))
      );
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
        (net as any).body.data.nodes.update(
          ids.map((id) => ({ id, fixed: { x: true, y: true } }))
        );
      } catch (e) {
        console.error("persist positions error:", e);
      }
    };

    net.on("dragStart", onDragStart);
    net.on("dragEnd", onDragEnd);
    return () => {
      net.off("dragStart", onDragStart);
      net.off("dragEnd", onDragEnd);
    };
  }, [locked]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "44px 1fr",
        gap: 8,
        height: "100%",
      }}
    >
      <div className="card graph-toolbar">
        <button
          className={`btn ${locked ? "accent" : "soft"}`}
          onClick={() => setLocked((v) => !v)}
          title={locked ? "Desbloquear arrastre" : "Bloquear arrastre"}
        >
          {locked ? "🔒 Bloqueado" : "🔓 Desbloqueado"}
        </button>
        <div className="stats">
          {loading
            ? "Cargando…"
            : `Nodos: ${data.nodes.length} | Enlaces: ${data.edges.length}`}
        </div>
      </div>

      <section className="graph-container graph-wrapper">
        <div ref={containerRef} className="graph-surface" />
      </section>
    </div>
  );
}
