import { cpSync, existsSync } from 'node:fs';

// tsc only compiles .ts files, so the static frontend (html/css/js) under
// src/web/public needs a plain file copy into dist/ after the build — this
// runs after `tsc` in the "build" npm script (see package.json).
const src = 'src/web/public';
const dest = 'dist/web/public';

if (existsSync(src)) {
  cpSync(src, dest, { recursive: true });
  console.log(`Copied ${src} -> ${dest}`);
}
