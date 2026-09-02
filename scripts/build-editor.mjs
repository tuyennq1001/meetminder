import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function build() {
  console.log('📦 Bundling CodeMirror 6 for Meet Minder...');
  
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'src/js/editor-entry.js')],
    bundle: true,
    format: 'esm',
    outfile: path.join(rootDir, 'src/js/vendor/codemirror-bundle.js'),
    minify: false,
    sourcemap: true,
    target: ['es2022'],
  });
  
  console.log('✅ Bundled CodeMirror 6 -> src/js/vendor/codemirror-bundle.js');
}

build().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
