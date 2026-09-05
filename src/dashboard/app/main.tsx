import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { I18nProvider } from "./lib/i18n-context.js";
import "./styles/globals.css";

const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>
);
