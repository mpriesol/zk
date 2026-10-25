import { readFileSync } from "node:fs";
// One non-secret setting selects build, runtime and gateway routing.
// This script only prints a reviewable fragment; it never changes a server file.
const value = process.env.APP_URL?.trim().replace(/\/$/, "");
const variants = {
  "https://hub.biketrek.sk/zk": "../deploy/Caddyfile.zk",
  "https://zimnykurz.sk/priprava": "../deploy/Caddyfile.zk.public",
};
const file = variants[value];
if (!file) {
  console.error(
    "APP_URL musí byť https://hub.biketrek.sk/zk alebo https://zimnykurz.sk/priprava. Načítaj konfiguráciu cez node --env-file=zk.env scripts/render-caddy.mjs.",
  );
  process.exit(1);
}
process.stdout.write(readFileSync(new URL(file, import.meta.url), "utf8"));
