import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: { spa: { enabled: true, prerender: { outputPath: "/index" } } },
  nitro: false,
  vite: {
    environments: {
      client: { build: { outDir: "dist" } },
      ssr: { build: { outDir: ".output/server" } },
    },
  },
});
