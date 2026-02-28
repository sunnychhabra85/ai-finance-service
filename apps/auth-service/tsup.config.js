import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['apps/auth-service/src/main.ts'],
  outDir: 'dist/apps/auth-service',
  format: ['cjs'],
  platform: 'node',
  target: 'node20',
  bundle: true,
  sourcemap: false,
  clean: true
})