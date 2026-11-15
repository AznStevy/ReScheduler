import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./App";
import { AppProvider } from "./state/store";
import { applyStoredTheme } from "./ui/theme";
import "./index.css";

applyStoredTheme();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppProvider>
        <Shell />
      </AppProvider>
    </StrictMode>,
  );
}
