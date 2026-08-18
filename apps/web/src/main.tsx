import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { LocaleProvider } from "./LocaleContext.tsx";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root missing");
try {
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </StrictMode>,
  );
} catch (err) {
  root.textContent = String(err);
}
