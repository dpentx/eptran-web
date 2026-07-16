import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
// SSR (output: "server") çünkü /api/ingest, /api/suggestions, /api/chapters/[id]/view
// gibi endpoint'ler ononoki-dp botundan ve okuyuculardan istek alacak.
export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [react()],
  security: {
    checkOrigin: false,
  },
});
