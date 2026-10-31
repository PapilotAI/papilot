import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { licenseInfoPlugin } from './scripts/licenses.ts';
export default defineConfig({ plugins: [react(), licenseInfoPlugin()], build: { outDir: 'dist' } });
