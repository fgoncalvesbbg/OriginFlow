
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all envs regardless of the `VITE_` prefix.
  // Added comment above fix: Cast process to any to access the Node.js cwd() method during build time
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    resolve: {
      alias: {
        jspdf: 'jspdf/dist/jspdf.es.min.js'
      }
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.SUPABASE_URL': JSON.stringify(env.SUPABASE_URL),
      'process.env.SUPABASE_ANON_KEY': JSON.stringify(env.SUPABASE_ANON_KEY),
      // Fallback for any other process.env usage
      'process.env': env
    },
    build: {
        outDir: 'dist',
        sourcemap: true
    }
  };
});
