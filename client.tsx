import React from "react";
import { createRoot } from "react-dom/client";
import Page from "./app/page";
import ErrorBoundary from "./components/ErrorBoundary";
import "./app/globals.css";
import "./app/redesign.css";
import { appPath } from "./lib/paths";
import { captureInstallPrompt } from "./components/install";

captureInstallPrompt();
// Registered early so the browser can offer installation; the worker has no
// fetch handler and caches nothing.
if ("serviceWorker" in navigator && window.isSecureContext)
  navigator.serviceWorker
    .register(appPath("/sw.js"), {
      scope: appPath("/"),
      updateViaCache: "none",
    })
    .catch(() => {});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Page />
    </ErrorBoundary>
  </React.StrictMode>,
);
