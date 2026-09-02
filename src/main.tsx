import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "leaflet/dist/leaflet.css";
import "./styles/index.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
