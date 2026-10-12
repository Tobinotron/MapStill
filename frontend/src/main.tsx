import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./map/worker";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
