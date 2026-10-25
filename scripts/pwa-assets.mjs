import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** The supported application base selected by APP_URL for this build/runtime. */
function validBase(basePath) {
  if (basePath !== "/zk" && basePath !== "/priprava")
    throw new Error("PWA base path must be /zk or /priprava.");
  return basePath;
}
export function createManifest(basePath) {
  const base = validBase(basePath);
  return {
    id: `${base}/`,
    name: "Cestou Zimy · príprava",
    short_name: "Cestou Zimy",
    description: "Dobrovoľná spoločná príprava na zimný kurz.",
    lang: "sk",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#ededed",
    theme_color: "#588d8c",
    icons: [
      {
        src: `${base}/brand/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/brand/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `${base}/brand/icon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
/** Generate one matching manifest for Vite build and development; SW uses its own scope. */
export function pwaAssetsPlugin(basePath) {
  const manifest = JSON.stringify(createManifest(basePath), null, 2) + "\n";
  let outputDirectory = "";
  return {
    name: "cestou-zimy-pwa-assets",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url || "/", "http://localhost").pathname;
        if (
          path !== `${basePath}/manifest.webmanifest` &&
          path !== "/manifest.webmanifest"
        )
          return next();
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/manifest+json");
        res.setHeader("Cache-Control", "no-store");
        res.end(manifest);
      });
    },
    async closeBundle() {
      if (!outputDirectory)
        throw new Error("Vite output directory was not resolved.");
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(
        resolve(outputDirectory, "manifest.webmanifest"),
        manifest,
      );
    },
  };
}
