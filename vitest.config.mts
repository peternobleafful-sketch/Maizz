import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Lets tests load the app's own route files, which import with "@/".
export default defineConfig({
  // The exhaustive fee test and the database tests can take a few seconds on a busy machine.
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
