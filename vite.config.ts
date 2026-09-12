import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      assert: 'assert/',
      events: 'events/',
      'isomorphic-ws': fileURLToPath(new URL('./src/integration/browser-websocket.ts', import.meta.url)),
    },
  },
});
