import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuses the Vite config (aliases, React plugin). Tests live next to the code under src/.
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
    },
  }),
);
