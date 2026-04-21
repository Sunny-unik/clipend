import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./components/SettingsApp";
import { TooltipApp } from "./components/TooltipApp";

const params = new URLSearchParams(window.location.search);
const windowKind = params.get("window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {windowKind === "settings" ? (
      <SettingsApp />
    ) : windowKind === "tooltip" ? (
      <TooltipApp />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
