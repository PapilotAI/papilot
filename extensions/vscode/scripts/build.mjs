import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as bundle } from 'esbuild';
import { build } from '../../../node_modules/vite/dist/node/index.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await bundle({ entryPoints: [path.join(root, 'src/extension.ts')], outfile: path.join(root, 'dist/extension.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], sourcemap: true });
for (const view of ['chat', 'paper', 'review']) await build({
  configFile: false, root, base: './', define: { 'process.env.NODE_ENV': JSON.stringify('production') }, resolve: { dedupe: ['react', 'react-dom'], alias: [
    { find: /^pdfjs-dist$/, replacement: path.resolve(root, '../../node_modules/pdfjs-dist/legacy/build/pdf.mjs') },
    { find: /^pdfjs-dist\/web\//, replacement: 'pdfjs-dist/legacy/web/' },
    { find: /^pdfjs-dist\/build\//, replacement: 'pdfjs-dist/legacy/build/' },
  ] },
  build: { outDir: path.join(root, 'dist/web', view), emptyOutDir: true,
    cssCodeSplit: false,
    rolldownOptions: { input: path.join(root, 'web', view + '.tsx'), output: { entryFileNames: 'view.js', assetFileNames: asset => asset.names?.some(name => name.endsWith('.css')) ? 'view.css' : 'assets/[name]-[hash][extname]' } } },
});
