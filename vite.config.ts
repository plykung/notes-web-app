import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import { APP_VERSION, RELEASES, actionNeeded, renderChangelogMd } from "./src/changelog";

// The page's own CSP allows the dev server's live-reload socket; production
// builds drop it (public/_headers sends the full production policy).
const productionCsp = (): Plugin => ({
  name: "production-csp",
  apply: "build",
  transformIndexHtml: (html) => html.replace(" ws://localhost:5173", ""),
});

// CHANGELOG.md is generated from src/changelog.ts, and /version.json tells an
// open app what the newest Release is (src/updates.ts).
const changelog = (): Plugin => ({
  name: "changelog",
  buildStart() {
    const md = renderChangelogMd();
    let current = "";
    try {
      current = readFileSync("CHANGELOG.md", "utf8");
    } catch {
      // first build: no file yet
    }
    if (current !== md) writeFileSync("CHANGELOG.md", md);
  },
  generateBundle() {
    const latest = RELEASES[0];
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ version: APP_VERSION, action: actionNeeded([latest]) }),
    });
  },
});

// The Entra redirect URI is registered as exactly http://localhost:5173, so the
// production preview (needed to test offline: the service worker only runs in
// a build) uses the same port.
export default defineConfig(({ command }) => ({
  plugins: [productionCsp(), changelog()],
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: {
    // The spike page is a developer diagnostic: it shows full note text and can
    // write to the mailbox, so it never ships. It's still served by `npm run dev`.
    rollupOptions: { input: command === "serve" ? { app: "index.html", spike: "spike.html" } : { app: "index.html" } },
  },
}));
