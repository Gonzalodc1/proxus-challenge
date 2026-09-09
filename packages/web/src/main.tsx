import { RegistryProvider } from "@effect/atom-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.generated.css";

// Apply the saved theme before the first paint to avoid a flash.
// Light is the default, matching the rest of the Proxus product.
try {
  if (localStorage.getItem("proxus-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
} catch {
  // localStorage may be unavailable (private mode); fall back to light.
}

const root = document.getElementById("root");

if (root === null) {
  throw new Error("Missing root element");
}

createRoot(root).render(
  <StrictMode>
    <RegistryProvider>
      <App />
    </RegistryProvider>
  </StrictMode>
);
