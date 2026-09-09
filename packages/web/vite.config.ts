import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendUrl = process.env.PROXUS_API_URL ?? "http://localhost:3000";
// `PORT` es el puerto de la API, no el de la web. Antes servia tambien de
// respaldo aqui, asi que un `PORT` en el entorno (habitual en cualquier maquina
// que haya arrancado otra cosa antes) ponia la API y el dev server en el mismo
// puerto y `pnpm run dev` fallaba con los dos peleandose.
const port = Number(process.env.WEB_PORT ?? "5173");

export default defineConfig({
  root: "src",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port,
    proxy: {
      "^/api(?:/|$)": {
        target: backendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
