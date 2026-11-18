import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { bookingsPlugin } from './server/bookingsPlugin.js';
import rooms from './src/data/rooms.json' with { type: 'json' };

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // No VITE_ prefix: this stays on the server and is never bundled into the app.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), bookingsPlugin(env.TIMEEDIT_ICS_URL, rooms.map((r) => r.id))],
  };
});
