import { useMemo } from "react";
import type { RouteSummary } from "../types";

function EmptyState() {
  return <div className="card">No hay rutas disponibles</div>;
}

type RowProps = {
  label: string;
  value?: string | number | null;
};
function Row({ label, value }: RowProps) {
  if (!value) return null;
  return (
    <div style={{ fontSize: 12, opacity: 0.85 }}>
      <b>{label}:</b> {value}
    </div>
  );
}

type CopyBtnProps = {
  text?: string | number | null;
  title?: string;
};
function CopyBtn({ text, title = "Copiar" }: CopyBtnProps) {
  if (!text) return null;
  const copy = () =>
    navigator.clipboard?.writeText(String(text)).catch(() => {});
  return (
    <button
      className="btn"
      onClick={copy}
      title={title}
      style={{ marginLeft: 8 }}
    >
      Copiar
    </button>
  );
}

type RouteListProps = {
  routes?: RouteSummary[];
  loading?: boolean;
  onOpenRoute?: (route: RouteSummary) => void;
};
export default function RouteList({ routes = [], onOpenRoute = () => {} }: RouteListProps) {
  const count = routes?.length || 0;
  const canOpen = typeof onOpenRoute === "function";

  const items = useMemo(() => (Array.isArray(routes) ? routes : []), [routes]);

  if (!count) return <EmptyState />;

  return (
    <>
      {items.map((r) => {
        const id = r?.id ?? "(sin id)";
        const from = r?.from_odf_id ?? "-";
        const to = r?.to_odf_id ?? "-";
        const subtitle = `${from} → ${to}`;

        const summaryText = r?.path_text || r?.span_list || "";

        return (
          <div key={id} className="card hoverable route-item">
            <div className="route-item-header">
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span className="route-item-title">{id}</span>
                  <span className="badge">Ruta</span>
                  {/*<CopyBtn text={id} title="Copiar Route ID" />*/}
                </div>
                <div
                  style={{
                    opacity: 0.85,
                    fontSize: 12,
                    marginTop: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={subtitle}
                >
                  {from} → {to}
                </div>
              </div>
              <button
                className="btn accent"
                onClick={() => canOpen && onOpenRoute(r)}
                disabled={!canOpen}
                title="Abrir detalle de ruta"
              >
                Abrir
              </button>
            </div>

            {!!summaryText && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  opacity: 0.85,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {summaryText}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export { CopyBtn, Row };
