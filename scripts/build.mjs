// build.mjs - Sestaví doplněk do dist/ (esbuild + kopírování statických souborů)
// Použití: node scripts/build.mjs [--watch]

import * as esbuild from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

// Soubory, které se kopírují beze změny (manifest odkazuje na background.js a popup.js)
const STATIC_FILES = ['manifest.json', 'popup.html', 'icons'];

await rm('dist', { recursive: true, force: true });

for (const file of STATIC_FILES) {
  await cp(`src/${file}`, `dist/${file}`, {
    recursive: true,
    filter: (source) => !source.endsWith('.md'),
  });
}

const options = {
  entryPoints: ['src/background.ts', 'src/popup.ts'],
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'firefox102',
  charset: 'utf8',
  logLevel: 'info',
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('Sleduji změny v src/ (statické soubory se při změně nekopírují, spusťte build znovu)');
} else {
  await esbuild.build(options);
}
