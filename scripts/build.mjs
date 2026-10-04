// Bundle the dashboard into one self-contained HTML page (the artifact) plus a
// standalone preview with a full document skeleton for local testing.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const result = await build({
  entryPoints: [`${root}src/ui/app.jsx`],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  write: false,
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = await readFile(`${root}src/ui/styles.css`, 'utf8');
const template = await readFile(`${root}src/index.html`, 'utf8');
const page = template.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
await mkdir(`${root}dist`, { recursive: true });
await writeFile(`${root}dist/trendjack.html`, page);
const preview = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">${page}</body></html>`;
await writeFile(`${root}dist/preview.html`, preview);
console.log(`dist/trendjack.html ${(page.length / 1024).toFixed(1)} KiB`);
