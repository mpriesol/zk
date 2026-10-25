import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { pwaAssetsPlugin } from "./scripts/pwa-assets.mjs";
import { basePathFromUrl } from "./lib/paths";

const appUrl = process.env.APP_URL || "https://zimnykurz.sk/priprava";
const appBasePath = basePathFromUrl(appUrl);
const buildConfigPlugin: Plugin = {
  name: "cestou-zimy-build-config",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "build-config.json",
      source: JSON.stringify({ appBasePath }, null, 2) + "\n",
    });
  },
};
export default defineConfig({
  base: appBasePath + "/",
  define: { __CZ_BASE_PATH__: JSON.stringify(appBasePath) },
  plugins: [react(), pwaAssetsPlugin(appBasePath), buildConfigPlugin],
  build: { outDir: "dist/client", emptyOutDir: true },
  server: {
    fs: {
      deny: [
        "**/.env*",
        "**/.data/**",
        "**/data/**",
        "**/*.sqlite*",
        "**/zk.env",
        "**/.git/**",
        "**/*.pem",
        "**/*.key",
        "**/*.p12",
        "**/*.pfx",
      ],
    },
    allowedHosts: ["terminal.local"],
    hmr: false,
  },
});
