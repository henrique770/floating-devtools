// Builds each extension entry as a self-contained IIFE (content scripts can't be ES modules).
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { build } from 'vite';
import { writeIcons } from './icons.mjs';

const watch = process.argv.includes('--watch');
const mode = watch ? 'development' : 'production';

const entries = [
  { name: 'main-world', entry: 'src/injected/main-world.ts' },
  { name: 'content', entry: 'src/content/index.tsx' },
  { name: 'background', entry: 'src/background.ts' },
];

for (const [i, { name, entry }] of entries.entries()) {
  await build({
    configFile: false,
    mode,
    logLevel: 'warn',
    plugins: [react()],
    publicDir: i === 0 ? 'public' : false,
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: {
      outDir: 'dist',
      emptyOutDir: i === 0,
      minify: !watch,
      sourcemap: watch ? 'inline' : false,
      watch: watch ? {} : null,
      lib: { entry, name: name.replace(/-/g, '_'), formats: ['iife'], fileName: () => `${name}.js` },
    },
  });
  console.log(`✓ ${name}.js`);
}

writeIcons('dist/icons');

// Bundled fonts (latin subset, weights 400/500/700) -> dist/fonts/<family>-<weight>.woff2
mkdirSync('dist/fonts', { recursive: true });
for (const family of readdirSync('node_modules/@fontsource')) {
  for (const weight of [400, 500, 700]) {
    copyFileSync(`node_modules/@fontsource/${family}/files/${family}-latin-${weight}-normal.woff2`, `dist/fonts/${family}-${weight}.woff2`);
  }
}
console.log(watch ? 'Watching for changes…' : 'Build pronto em dist/');
