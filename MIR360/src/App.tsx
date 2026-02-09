import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Suspense, lazy, useEffect, useState } from "react";

import Toolbar from "./components/Toolbar";
import RouteList from "./components/RouteList";
import DetailsPanel from "./components/DetailsPanel";
import api from "./api/client";
import type { RouteSummary, SelectionPayload, ViewMode } from "./types";

const GraphOverview = lazy(() => import("./components/GraphOverview"));
const RouteDetailGraph = lazy(() => import("./components/RouteDetailGraph"));

const LAST_ROUTE_KEY = "auwin:lastRouteId"; // Temp

function useViewFromLocation(): ViewMode {
  const { pathname } = useLocation();
  return pathname.startsWith("/routes") ? "route" : "overview";
}

type SidebarBlockProps = {
  showHeader?: boolean;
  loadingRoutes: boolean;
  routes: RouteSummary[];
  selected: SelectionPayload | null;
  onOpenRoute:(route:RouteSummary)=>void;
}

const SidebarBlock = ({
  showHeader = true,
  loadingRoutes,
  routes,
  selected,
  onOpenRoute,
}: SidebarBlockProps ) => (
  <>
    {showHeader && (
      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Rutas Lógicas</h3>
          <span className="badge">
            {loadingRoutes ? "Cargando..." : "Activas"}
          </span>
        </div>
        <p className="card-subtitle">
          Selecciona una para ver su planta externa.
        </p>
        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
          {loadingRoutes ? "Actualizando rutas..." : `Total: ${routes.length}`}
        </div>
      </div>
    )}

    <DetailsPanel selected={selected} />

    <RouteList routes={routes} loading={loadingRoutes} onOpenRoute={onOpenRoute}
    />
  </>
);

type RouteDetailWrapperProps = {
  onSelect:(selection:SelectionPayload|null)=>void;
};
const RouteDetailWrapper = ({ onSelect }: RouteDetailWrapperProps) => {
  const  { routeId } = useParams();
  return <RouteDetailGraph route={{ id: routeId! }} onSelect={onSelect} />;
};

export default function App() {
  const navigate = useNavigate();
  const view = useViewFromLocation();

  const [routes, setRoutes] = useState<RouteSummary[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);

  const [selected, setSelected] = useState<SelectionPayload | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingRoutes(true);
      try {
        const r = await api.get("/topology/routes");
        if (!alive) return;
        setRoutes(Array.isArray(r.data) ? r.data : []);
      } catch (e) {
        console.error("GET /topology/routes error:", e);
        if (!alive) return;
        setRoutes([]);
      } finally {
        if (alive) setLoadingRoutes(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onChangeView = (v: ViewMode) => {
    if (v === "overview") {
      navigate("/overview");
      return;
    }
    if (v === "route") {
      const last = sessionStorage.getItem(LAST_ROUTE_KEY);
      if (last) navigate(`/routes/${encodeURIComponent(last)}`);
    }
  };
  const onBack = () => navigate("/overview");

  const openRoute = (r: RouteSummary) => {
    if (!r?.id) return;
    sessionStorage.setItem(LAST_ROUTE_KEY, r.id);
    navigate(`/routes/${encodeURIComponent(r.id)}`);
  };

  return (
    <div className="app app-shell">
      <Toolbar view={view} onChangeView={onChangeView} onBack={onBack} />

      <div className="app-content">
        <Suspense fallback={<div className="card">Cargando…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/overview" replace />} />

            {/* OVERVIEW */}
            <Route
              path="/overview"
              element={
                <div className="app-grid">
                  <div className="app-sidebar">
                    <SidebarBlock
                      showHeader={true}
                      loadingRoutes={loadingRoutes}
                      routes={routes}
                      selected={selected}
                      onOpenRoute={openRoute}
                    />
                  </div>

                  <div className="app-main">
                    <GraphOverview
                      onSelect={(selection) => setSelected(selection)}
                      onOpenRoute={(routeId) => {
                        if (!routeId) return;
                        sessionStorage.setItem(LAST_ROUTE_KEY, routeId);
                        navigate(`/routes/${encodeURIComponent(routeId)}`);
                      }}
                    />
                  </div>
                </div>
              }
            />

            {/* ROUTE DETAIL */}
            <Route
              path="/routes/:routeId"
              element={
                <div className="app-grid">
                  <div className="app-sidebar">
                    <SidebarBlock
                      showHeader={false}
                      loadingRoutes={loadingRoutes}
                      routes={routes}
                      selected={selected}
                      onOpenRoute={openRoute}
                    />
                  </div>

                  <div className="app-main">
                    <RouteDetailWrapper onSelect={(selection) => setSelected(selection)} />
                  </div>
                </div>
              }
            />

            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Routes>
        </Suspense>
      </div>
    </div>
  );
}
