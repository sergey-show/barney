import react from "@vitejs/plugin-react";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

function vendorMermaid(): Plugin {
  const dest = join(root, "public/vendor/mermaid");
  const src = join(root, "../../node_modules/mermaid/dist");
  return {
    name: "vendor-mermaid",
    buildStart() {
      mkdirSync(join(dest, "chunks/mermaid.esm.min"), { recursive: true });
      cpSync(join(src, "mermaid.esm.min.mjs"), join(dest, "mermaid.esm.min.mjs"));
      cpSync(join(src, "chunks/mermaid.esm.min"), join(dest, "chunks/mermaid.esm.min"), {
        recursive: true,
        filter: (from) => !from.endsWith(".map"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), vendorMermaid()],
  root,
  resolve: {
    alias: {
      "@domain": fileURLToPath(new URL("../../src/domain", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
    proxy: {
      "/api": "http://127.0.0.1:7331",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
