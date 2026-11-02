import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Free OCR for the schedule import (tesseract.js) runs from our own site, not a
 * CDN: the worker, the WebAssembly engine and the Hebrew/English language data
 * are copied from node_modules to /ocr/ (served in dev, emitted on build).
 */
function ocrAssets(): Plugin {
  const req = createRequire(import.meta.url);
  const pkg = (name: string) => dirname(req.resolve(`${name}/package.json`));
  const files: Record<string, string> = {
    'ocr/worker.min.js': join(pkg('tesseract.js'), 'dist/worker.min.js'),
    'ocr/lang/heb.traineddata.gz': join(pkg('@tesseract.js-data/heb'), '4.0.0_best_int/heb.traineddata.gz'),
    'ocr/lang/eng.traineddata.gz': join(pkg('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'),
  };
  for (const v of ['', '-simd', '-relaxedsimd']) {
    files[`ocr/tesseract-core${v}-lstm.wasm.js`] = join(pkg('tesseract.js-core'), `tesseract-core${v}-lstm.wasm.js`);
  }
  return {
    name: 'ocr-assets',
    configureServer(server) {
      server.middlewares.use((rq, res, next) => {
        const path = (rq.url ?? '').split('?')[0].replace(/^\//, '');
        const src = files[path];
        if (!src) return next();
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(src));
      });
    },
    generateBundle() {
      for (const [fileName, src] of Object.entries(files)) this.emitFile({ type: 'asset', fileName, source: readFileSync(src) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), ocrAssets()],
});
