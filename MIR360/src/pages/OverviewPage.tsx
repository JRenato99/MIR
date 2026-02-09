import { useCallback, useEffect, useState } from "react";
import {useNavigate} from "react-router-dom";
import GraphOverview from "../components/GraphOverview";
import DetailsPanel from "../components/DetailsPanel";
import RouteList from "../components/RouteList";
import api from "../api/client";
import type { RouteSummary, SelectionPayload } from "../types";

export default function OverviewPage() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<SelectionPayload | null>(null);
  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const loadRoutes = useCallback(async () => {
    setLoadingRoutes(true);
    try {
      const r = await api.get("/topology/routes");
      setRoutes(Array.isArray(r.data) ? r.data : []);
    } finally {
      setLoadingRoutes(false);
    }
  }, []);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "340px 1fr",
        gap: 12,
        height: "100%",
      }}
    >
      <div className="sidebar" style={{ overflow: "auto", paddingRight: 4 }}>
        <div className="card">
          <h3 style={{ margin: 0 }}>Vista Principal</h3>
          <p style={{ opacity: 0.7, marginTop: 4 }}>
            Clic en <b>Nodo</b> para ver detalles. Doble clic en un{" "}
            <b>enlace</b> para abrir la ruta.|
          </p>
        </div>
        <DetailsPanel selected={selected} />

        <div className="card" style={{ marginTop: 12 }}>
          <h3 style={{ margin: 0 }}>Rutas Lógicas</h3>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            {loadingRoutes ? "Cargando…" : `Total: ${routes.length}`}
          </div>
        </div>
        <RouteList
          routes={routes}
          onOpenRoute={(r) => r?.id && navigate(`/route/${r.id}`)}
        />
      </div>
      {/* Lienzo */}
      <div className="main" style={{ position: "relative", minHeight: 0 }}>
        <GraphOverview onSelect={setSelected} />
      </div>
    </div>
  );
}
