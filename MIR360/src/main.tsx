import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/app.css";

function ensureRootElement(id = "root"): HTMLElement {
  let el = document.getElementById(id);
  if (!el) {
    console.warn(`[main] No existe #${id}. Creando uno dinámicamente.`);
    el = document.createElement("div");
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

const rootEl = ensureRootElement("root");
const root = createRoot(rootEl);

root.render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
