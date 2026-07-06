import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // dedicated port — must match the agent's CORS_ORIGIN
    port: 5180,
    strictPort: true,
    fs: {
      // allow importing ../shared/abi/NyxBatchAuction.json (forge artifact)
      // from outside the web/ root once it exists
      allow: ['.', '..'],
    },
  },
});
