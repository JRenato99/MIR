import { useState } from "react";
import api from "../api/client";

type TraceInfo = {
  affected_count?: number;
  hops?: unknown[];
};

type FiberTracePanelProps = {
  onHighlight?: (hops: unknown[]) => void;
  onClear?: () => void;
};

export default function FiberTracePanel({ onHighlight, onClear }: FiberTracePanelProps) {
  const [mode, setMode] = useState("fiber"); // 'fiber' | 'odf_port'
  const [value, setValue] = useState("");
  const [info, setInfo] = useState<TraceInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const doTrace = async () => {
    if (!value) return;
    setLoading(true);
    try {
      let res;
      if (mode === "fiber") {
        res = await api.get(`/fibers/${encodeURIComponent(value)}/trace`);
      } else {
        res = await api.get(
          `/fibers/odf-ports/${encodeURIComponent(value)}/trace`
        );
      }
      const data = res?.data || null;
      setInfo(data);
      if (Array.isArray(data?.hops) && typeof onHighlight === "function") {
        onHighlight(data.hops);
      }
    } catch (e) {
      console.error("Trace error:", e);
      alert("No se pudo trazar. Revisa consola.");
    } finally {
      setLoading(false);
    }
  };

  const clearTrace = () => {
    setInfo(null);
    if (typeof onClear === "function") onClear();
  };

  return (
    <div className="card">
      <b>Traza de Fibra</b>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <select
          className="select"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="fiber">Por Fiber ID</option>
          <option value="odf_port">Por ODF Port ID</option>
        </select>
        <input
          className="select"
          placeholder={mode === "fiber" ? "F-..." : "OP-..."}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn" onClick={doTrace} disabled={loading || !value}>
          Trazar
        </button>
        <button className="btn" onClick={clearTrace} disabled={loading}>
          Limpiar
        </button>
      </div>

      {info && (
        <div style={{ marginTop: 8 }}>
          <details open>
            <summary>
              <b>Resultado</b>
            </summary>
            <div style={{ marginTop: 8 }}>
              {"affected_count" in info && (
                <div>
                  <b>Afectados:</b> {info?.affected_count ?? "-"}
                </div>
              )}
              <div>
                <b>Saltos:</b> {Array.isArray(info?.hops) ? info.hops.length : 0}
              </div>
            </div>
            {Array.isArray(info?.hops) && (
              <pre className="code-block">
                {JSON.stringify(info.hops, null, 2)}
              </pre>
            )}
          </details>
        </div>
      )}
    </div>
  );
}
