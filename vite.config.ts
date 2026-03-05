import { defineConfig, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // Transform JSX in .js files before Rollup's import analysis
    {
      name: 'treat-js-as-jsx',
      enforce: 'pre' as const,
      async transform(code: string, id: string) {
        if (!id.match(/\.js$/) || id.includes('node_modules')) return null;
        return transformWithEsbuild(code, id, { loader: 'jsx' });
      },
    },
    react(),
  ],
  base: './',
  build: {
    outDir: 'dist',
  },
  resolve: {
    // Prefer .ts/.tsx over .js/.jsx so TypeScript files shadow old JS stubs
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    alias: {
      path: 'path-browserify',
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
})
