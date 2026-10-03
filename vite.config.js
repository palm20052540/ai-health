import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { sites } from "@openai/sites-vite-plugin";

export default defineConfig({
  plugins: [cloudflare(), sites()],
});
