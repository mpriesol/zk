import React from "react";
import { createRoot } from "react-dom/client";
import Page from "./app/page";
import ErrorBoundary from "./components/ErrorBoundary";
import "./app/globals.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Page />
    </ErrorBoundary>
  </React.StrictMode>,
);
