import { memo } from "react";

type LayerConfig = Array<[string, string]>;

type LayerControlsProps = {
  layers?: Record<string, boolean>;
  onToggle?: (key: string, enabled: boolean) => void;
  config?: LayerConfig;
};

const DEFAULT_CFG: LayerConfig = [
  ["router", "Routers"],
  ["odf", "ODFs"],
  ["pole", "Postes"],
  ["mufa", "Mufas"],
  ["span", "Spans"],
  ["patch", "Patches"],
  ["odf_link", "ODF-PE"],
  ["pole_mufa", "Pole-Mufa"],
];

function LayerControls({
  layers = {},
  onToggle = () => {},
  config = DEFAULT_CFG,
}: LayerControlsProps) {
  const allOn = config.every(([k]) => !!layers[k]);
  const allOff = config.every(([k]) => !layers[k]);

  const setAll = (next: boolean) => {
    config.forEach(([k]) => {
      if (!!layers[k] !== next) onToggle(k, next);
    });
  };

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <b>Capas</b>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => setAll(true)}
            disabled={allOn}
            title="Activar todas"
          >
            Activar
          </button>
          <button
            className="btn"
            onClick={() => setAll(false)}
            disabled={allOff}
            title="Desactivar todas"
          >
            Desactivar
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginTop: 8,
        }}
      >
        {config.map(([key, label]) => {
          const checked = !!layers[key];
          return (
            <label
              key={key}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                cursor: "pointer",
                userSelect: "none",
              }}
              title={label}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(key, !checked)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default memo(LayerControls);
