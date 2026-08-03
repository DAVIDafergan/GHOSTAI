import { build } from 'esbuild';

// Content scripts declared in manifest.json's "js" arrays load as classic
// (non-module) scripts, so they can't contain `import`/`export` - but Vite's
// default build code-splits modules shared between entries (e.g. this and
// the popup both import shared/messages.ts) into separate chunk files,
// which only works when loaded as ES modules. Bundling these two entries
// separately with esbuild in IIFE format keeps each one fully self-contained.
const entries = [
  'src/main-world/content-main.ts',
  'src/isolated/content-isolated.ts',
  'src/background/background.ts',
];

for (const entry of entries) {
  const outfile = `dist/${entry.split('/').pop().replace('.ts', '.js')}`;
  await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome110'],
    outfile,
    sourcemap: true,
  });
  console.log(`built ${outfile}`);
}
