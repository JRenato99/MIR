import { useEffect, useState } from "react";
import api from "../api/client";
import type { SelectionPayload } from "../types";

type MufaSplice = {
  splice_id: string;
  a: {
    cable_code?: string;
    color_code?: string;
    filament_no?: number;    
  };
  b: {
    cable_code?: string;
    color_code?: string;
    filament_no?: number;    
  };
};

type MufaGroup = {
  pair: string;
  count: number;
}

type MufaDetails = {
  mufa?: {
    code?: string;
    id?: string;
    mufa_type?: string;
    gps_lat?: number;
    gps_lon?: number;
  };  
  groups?: MufaGroup[];
  splices?: MufaSplice[];
};

type PoleDetails = {
  pole?: Array<{
    id?: string;
    code?: string;
    pole_type?: string;
    owner?: string;
    district?: string;
    address_ref?: string;
    gps_lat?: number;
    gps_lon?: number;
    status?: string;
    high?: number;
    has_cruceta?: boolean;
    has_reserve?: boolean;
    reserve_length_m?: number;
    has_elem_retencion?: boolean;
    has_elem_suspension?: boolean;
    declared?: boolean;
  }>;
  summary?: {
    mufa_count?: number;
    span_count?: number;
    total_length_m?: number;
    cable_count?: number;
    neighbor_count?: number;
  };
  mufas?: Array<{
    id?: string;
    code?: string;
    mufa_type?: string;
    splice_count?: number;
  }>;
  spans?: Array<{
    id?: string;
    seq?: number;
    cable_code?: string;
    fiber_count?: number;
    from_pole_id?: string;
    to_pole_id?: string;
    length_m?: number;
  }>;
  cables?: Array<{
    id?: string;
    code?: string;
    fiber_count?: number;
    material_type?: string;
    jacket_type?: string;
  }>;
  neighbors?: Array<{
    via_span_id?: string;
    neighbor_pole_code?: string;
    length_m?: number;
  }>;
};

type DetailsData =
  | { kind: "POLE"; details: PoleDetails; }
  | { kind: "MUFA"; details: MufaDetails; }  
  | { kind: String | null; raw: unknown; };

type DetailsState = {
  loading: boolean;
  error: string;
  data: DetailsData | null;
};

function isPoleData(d: DetailsData | null): d is { kind: "POLE"; details: PoleDetails } {
  return !!d && d.kind === "POLE" && "details" in d;
}

function isMufaData(d: DetailsData | null): d is { kind: "MUFA"; details: MufaDetails } {
  return !!d && d.kind === "MUFA" && "details" in d;
}

type ColorDotProps = {
  code?: string | null;
};

function ColorDot({ code }: ColorDotProps) {
  if (!code) return null;
  const size = 10;
  return (
    <span
      title={code}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 99,
        border: "1px solid #ccc",
        background: code,
        marginRight: 6,
        verticalAlign: "middle",
      }}
    />
  );
}

function normalizePair(s?: string | null) {
  // Unifica "→" y "->", colapsa espacios, y compara en minúsculas
  return String(s || "")
    .replace(/\s*→\s*/g, "->")
    .replace(/\s*-\s*>\s*/g, "->")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type MufaSplicesProps = {
  data?: MufaDetails | null;
};
function MufaSplices({ data }: MufaSplicesProps) {
  const [pairFilter, setPairFilter] = useState("");

  if (!data) return null;
  const rows = !data.splices
    ? []
    : pairFilter
    ? data.splices.filter(
        (s) =>
          normalizePair(`${s.a.cable_code} -> ${s.b.cable_code}`) ===
          normalizePair(pairFilter)
      )
    : data.splices;

  const m = data.mufa || {};

  return (
    <div className="card stack" style={{ maxHeight: "320px", overflow: "auto" }}>
      <div className="card-header">
        <h3 className="card-title">MUFA {m.code ?? m.id}</h3>
        {m.mufa_type ? <span className="badge">{m.mufa_type}</span> : null}
      </div>

      {/* Datos Base Mufa */}
      <div className="muted" style={{ fontSize: 12 }}>        
        {m.gps_lat != null && m.gps_lon != null ? (
          <span>
            GPS: {m.gps_lat}, {m.gps_lon}{" "}
            <button
              className="btn soft"
              style={{ marginLeft: 6, padding: "2px 8px", fontSize: 12 }}
              onClick={() =>
                navigator.clipboard.writeText(`${m.gps_lat},${m.gps_lon}`)
              }
              title="Copiar latitud y longitud"
            >
              Copiar GPS
            </button>
          </span>
        ) : null}
      </div>

      <details open>
        <summary>
          <b>Resumen por cambio de cables</b>{" "}
          <span className="muted">(clic para expandir)</span>
        </summary>
        <ul className="compact" style={{ marginTop: 8 }}>
          {(data.groups || []).map((g) => (
            <li key={g.pair} style={{ cursor: "pointer" }}>
              <span
                className="badge"
                onClick={() =>
                  setPairFilter(g.pair === pairFilter ? "" : g.pair)
                }
                title="Filtrar tabla por este par"
              >
                {g.pair} | {g.count}
              </span>
            </li>
          ))}
        </ul>
        {pairFilter ? (
          <div style={{ marginTop: 6 }}>
            Filtro activo: <b>{pairFilter}</b>{" "}
            <button
              className="btn soft"
              style={{ marginLeft: 6, padding: "2px 8px", fontSize: 12 }}
              onClick={() => setPairFilter("")}
            >
              Quitar filtro
            </button>
          </div>
        ) : null}
      </details>

      {/* Tabla de empalmes */}
      <div style={{ marginTop: 12, overflow: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: 6,
                }}
              >
                Cable A
              </th>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: 6,
                }}
              >
                Film A
              </th>
              <th
                style={{
                  borderBottom: "1px solid #ddd",
                  padding: 6,
                  width: 60,
                }}
              >
                ||
              </th>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: 6,
                }}
              >
                Cable B
              </th>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: 6,
                }}
              >
                Film B
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted" style={{ padding: 8 }}>
                  No hay empalmes por mostrar
                </td>
              </tr>
            ) : (
              rows.map((s) => (
                <tr key={s.splice_id}>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    <span className="badge">{s.a.cable_code}</span>
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    <ColorDot code={s.a.color_code} />#{s.a.filament_no}
                  </td>
                  <td
                    style={{
                      padding: 6,
                      borderBottom: "1px solid #eee",
                      textAlign: "center",
                      opacity: 0.6,
                    }}
                    title={s.splice_id}
                  >
                    →
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    <span className="badge">{s.b.cable_code}</span>
                  </td>
                  <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                    <ColorDot code={s.b.color_code} />#{s.b.filament_no}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type PoleDetailsProps = {
  d: PoleDetails;
};
function PoleDetails({ d } : PoleDetailsProps) {
  const p = d.pole?.[0] || {};
  const s = d.summary || {};
  const mufas = d.mufas || [];
  const spans = d.spans || [];
  const cables = d.cables || [];
  const neighbors = d.neighbors || [];

  return (
    <div className="stack" style={{ maxHeight: "220px", overflow: "auto" }}>
      <div>
        <div className="card-header">
          <b>Pole</b>
          <span className="badge">{p.pole_type ?? "Sin Tipo"}</span>
        </div>
        <ul className="compact">
          <li>
            <b>ID:</b> {p.id}
          </li>
          <li>
            <b>Código:</b> {p.code}
          </li>
          <li>
            <b>Tipo:</b> {p.pole_type}
          </li>
          <li>
            <b>Owner:</b> {p.owner ?? "-"}
          </li>
          <li>
            <b>Distrito:</b> {p.district ?? "-"}
          </li>
          <li>
            <b>Dirección ref:</b> {p.address_ref ?? "-"}
          </li>
          <li>
            <b>GPS:</b> {p.gps_lat ?? "-"}, {p.gps_lon ?? "-"}
          </li>
          <li>
            <b>Estado:</b> {p.status ?? "-"}
          </li>
          <li>
            <b>Altura:</b> {p.high ?? "-"}
          </li>
          <li>
            <b>Cruceta:</b> {p.has_cruceta ? "Sí" : "No"}
          </li>
          <li>
            <b>Reserva:</b>{" "}
            {p.has_reserve ? `Sí (${p.reserve_length_m ?? "?"} m)` : "No"}
          </li>
          <li>
            <b>Elem. retención:</b> {p.has_elem_retencion ? "Sí" : "No"}
          </li>
          <li>
            <b>Elem. suspensión:</b> {p.has_elem_suspension ? "Sí" : "No"}
          </li>
          <li>
            <b>Declarado:</b> {p.declared ? "Sí" : "No"}
          </li>
        </ul>
      </div>

      <div className="badge">
        Mufas: {s.mufa_count} | Spans: {s.span_count} | Longitud total:{" "}
        {Math.round(Number(s.total_length_m || 0))} m | Cables: {s.cable_count} |
        Vecinos: {s.neighbor_count}
      </div>

      {mufas.length > 0 && (
        <details>
          <summary>
            <b>Mufas ({mufas.length})</b>
          </summary>
          <ul className="compact">
            {mufas.map((m) => (
              <li key={m.id}>
                {m.code} — tipo: {m.mufa_type} — empalmes: {m.splice_count}
              </li>
            ))}
          </ul>
        </details>
      )}

      {spans.length > 0 && (
        <details>
          <summary>
            <b>Empalmes conectados ({spans.length})</b>
          </summary>
          <ul className="compact">
            {spans.map((sp) => (
              <li key={sp.id}>
                [{sp.seq}] {sp.id} — cable {sp.cable_code} ({sp.fiber_count}f) —{" "}
                {sp.from_pole_id} → {sp.to_pole_id} —{" "}
                {Math.round(Number(sp.length_m || 0))} m
              </li>
            ))}
          </ul>
        </details>
      )}

      {cables.length > 0 && (
        <details>
          <summary>
            <b>Cables ({cables.length})</b>
          </summary>
          <ul className="compact">
            {cables.map((c) => (
              <li key={c.id}>
                {c.code} — {c.fiber_count}f — {c.material_type ?? "-"} /{" "}
                {c.jacket_type ?? "-"}
              </li>
            ))}
          </ul>
        </details>
      )}

      {neighbors.length > 0 && (
        <details>
          <summary>
            <b>Postes vecinos ({neighbors.length})</b>
          </summary>
          <ul className="compact">
            {neighbors.map((n) => (
              <li key={n.via_span_id}>
                {n.neighbor_pole_code} (via {n.via_span_id}) —{" "}
                {Math.round(Number(n.length_m || 0))} m
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type DetailsPanelProps = {
  selected: SelectionPayload | null;
};
export default function DetailsPanel({ selected } : DetailsPanelProps) {
  const [state, setState] = useState<DetailsState>({
    loading: false,
    error: "",
    data: null,
  });

  const { loading, error, data } = state;

  const selNode = selected?.node || null;
  const selEdge = selected?.edge || null;

  useEffect(() => {
    // Si no hay nada seleccionado: no hago fetch
    if (!selNode && !selEdge) {
      setState({ loading: false, error: "", data: null });
      return;
    }

    // Por ahora implementamos POLE; deja stub para otros tipos
    const kind = selNode?.kind || selEdge?.edge_kind || null;

    async function load() {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
      try {
        let newData: DetailsData | null = null;
        if (selNode) {
          if (kind === "POLE") {
            const r = await api.get(
              `/topology/poles/${encodeURIComponent(selNode.id)}/details`
            );
            newData = { kind: "POLE", details: r.data };
          } else if (kind === "MUFA") {
            const r = await api.get(
              `/topology/mufas/${encodeURIComponent(selNode.id)}/splices`
            );
            console.log(selNode.id);
            newData = { kind: "MUFA", details: r.data };
          } else {
            newData = { kind, raw: selNode };
          }
        } else if (selEdge) {
          newData = { kind: selEdge.edge_kind || "EDGE", raw: selEdge };
        }
        setState({ loading: false, error: "", data: newData });
      } catch (e) {
        const msg =
          (e as { response?: { data?: { detail?: string } }; message?: string })
            .response?.data?.detail ||
          (e as { message?: string })?.message ||
          "Error cargando detalles";
        setState({ loading: false, error: msg, data: null });
      }
    }

    load();
  }, [selNode, selEdge]);

  if (!selected) {
    return (
      <div className="card">
        <div className="card-header">
          <b>Detalles</b>
          <span className="badge">Intereacción</span>
        </div>
        <p className="card-subtitle">
          Selecciona un elemento del grafo para ver detalles.
        </p>
      </div>
    );
  }

  return (
    <div className="card stack" style={{ marginTop: 12 }}>
      <div className="card-header">
        <h3 className="card-title">Detalles</h3>
        <span className="badge">{data?.kind ?? "Selección"}</span>
      </div>

      {!selNode && !selEdge && (
        <div className="muted">Selecciona un nodo o un segmento.</div>
      )}

      {loading && <div className="muted">Cargando…</div>}

      {!!error && <div style={{ color: "#b91c1c" }}>{String(error)}</div>}

      {/* POLE */}
      {isPoleData(data) && (
        <div style={{ marginTop: 8 }}>
          <PoleDetails d={data.details} />
        </div>
      )}

      {/* MUFA */}
      {isMufaData(data) && (
        <div style={{ marginTop: 8 }}>
          <MufaSplices data={data.details} />
        </div>
      )}

      {/* Otros tipos (aún sin endpoint dedicado) */}
      {data && data.kind !== "POLE" && data.kind !== "MUFA" && "raw" in data && (
        <pre className="code-block" style={{ marginTop: 8 }}>
          {JSON.stringify(data.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}
