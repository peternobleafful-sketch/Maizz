import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Lets tests load the app's own route files, which import with "@/".
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
