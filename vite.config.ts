
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
    optimizeDeps: {
      // pdf.js is reachable only through the React.lazy() import in DesignSpecReviewPortal,
      // and Vite's startup scan does not pre-bundle it (no `exports` map, bare .mjs main).
      // The first design-spec open therefore made the dev server optimize it mid-session,
      // which re-hashes the whole dep bundle: the already-mounted page then loads modules
      // against the NEW ?v= hash while holding React from the old one. Two React copies mean
      // two context registries, so every useContext reads undefined and the app dies on the
      // first one it hits — "useAuth must be used within an AuthProvider". Naming it here
      // pre-bundles it at server start, so one hash serves the whole session.
      include: ['pdfjs-dist'],
    },
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
