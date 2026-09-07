
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  return {
    // Only VITE_-prefixed build-env vars are exposed to the client bundle. The Netlify
    // environment also holds SUPABASE_SERVICE_ROLE_KEY (server-only, read by netlify/functions/*
    // via process.env) — it must never be reachable through import.meta.env, so 'SUPABASE_' is
    // deliberately NOT in this list. The app's own client config only ever reads
    // VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see src/config/environment.config.ts).
    envPrefix: ['VITE_'],
    plugins: [react()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'netlify/**/*.test.ts'],
    },
    build: {
        outDir: 'dist',
        // Sourcemaps are dev-only: Netlify serves the entire `dist` publish directory (see
        // netlify.toml [build]), so any map file written into it is fetchable in prod even if
        // the bundle omits the `//# sourceMappingURL` comment ('hidden' would not stop that).
        // Disabling generation outright for a production build is the only way to keep full
        // readable TS/JSX source out of the shipped bundle. Local debugging is unaffected: `npm
        // run start` (vite dev) always serves untransformed source via its own dev-server
        // sourcemaps regardless of this option.
        sourcemap: mode !== 'production',
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: ['react', 'react-dom', 'react-router-dom'],
            }
          }
        }
    }
  };
});
