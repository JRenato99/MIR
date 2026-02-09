import type { ViewMode } from "../types";

type toolbarProps = {
  view?: ViewMode;
  onChangeView?: (view: ViewMode) => void;
  onBack?: () => void;
};

export default function Toolbar({
  view = "overview",
  onChangeView = () => {},
  onBack,
}: toolbarProps) {
  const isOverview = view === "overview";
  const isRoute = view === "route";
  
  return (
    <div className="toolbar">
      <div className="toolbar-title">
        <strong>AUWIN</strong>
        <span>Network Operations</span>
      </div>
      <div style={{ flex: 1 }}></div>

      {isRoute && typeof onBack === "function" && (
        <button className="btn soft" onClick={onBack} title="Volver">
          Volver
        </button>
      )}

      <div className="toolbar-actions">
        <div className="toolbar-tabs">
          <button
            className={`btn ${isOverview ? "active" : ""}`}
            onClick={() => onChangeView("overview")}
            aria-pressed={isOverview}
            disabled={isOverview}
            title="Overview"
          >
            Overview
          </button>
          <button
            className={`btn ${isRoute ? "active" : ""}`}
            onClick={() => onChangeView("route")}
            aria-pressed={isRoute}
            disabled={isRoute}
            title="Ruta"
          >
            Ruta
          </button>
        </div>
      </div>
    </div>
  );
}
