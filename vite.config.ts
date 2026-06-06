
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    envPrefix: ['VITE_', 'SUPABASE_'],
    plugins: [react()],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
    build: {
        outDir: 'dist',
        sourcemap: true,
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
