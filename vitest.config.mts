import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // The mutation fixtures are deliberately broken repositories, one per rule.
    // A test collector reads them as source; they are the proof the checks fire.
    exclude: ["node_modules/**", ".next/**", ".software-factory/**"],
  },
});
