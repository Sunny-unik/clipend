import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./components/SettingsApp";

const params = new URLSearchParams(window.location.search);
const isSettings = params.get("window") === "settings";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettings ? <SettingsApp /> : <App />}
  </React.StrictMode>,
);
