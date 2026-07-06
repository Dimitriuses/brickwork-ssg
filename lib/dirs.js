'use strict';
// A site's directory layout — resolved in ONE place so folders are declared once. By default the
// conventional layout; a site can relocate any of them via a `dirs` block in config.json (granular
// per-dir), covering the whole workspace — source (pages/components/generators), assets, and the
// build **output**, **test**, and **log** folders:
//
//   "dirs": { "pages": "src/pages", "components": "src/components", "generators": "src/generators",
//             "assets": "shared/assets", "output": "build", "test": "test", "log": "log",
//             "database": "shared/database.json" }
//
// Every key defaults to today's layout, so the block is fully optional and backward-compatible. The
// log dir here is the single source for the file sink's folder (it supersedes `log.file.dir`).
// `database` is the one entry that names a **file** (the collections DB), not a folder — the build (and
// the admin extension) resolve it here instead of hardcoding shared/database.json. config.json itself
// stays at the site root (it bootstraps this); collection **sources** stay site-root-relative.
// See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');

const DEFAULT_DIRS = {
  pages: 'pages',
  components: 'components',
  generators: 'generators',
  assets: 'assets',
  output: 'build',
  test: 'test',
  log: 'log',
  database: 'shared/database.json' // a file, not a folder — the collections DB
};

// The site-relative dir strings from config.json `dirs`, merged over the defaults. Pass a pre-loaded
// `config` to avoid re-reading config.json; otherwise it is read from siteRoot (missing/invalid =>
// defaults). A non-string / blank entry falls back to the default for that key.
function dirNames(siteRoot, config) {
  let cfg = config;
  if (!cfg) {
    try { cfg = JSON.parse(fs.readFileSync(path.join(siteRoot, 'config.json'), 'utf8')); } catch (e) { cfg = {}; }
  }
  const block = (cfg && typeof cfg.dirs === 'object' && cfg.dirs) ? cfg.dirs : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_DIRS)) {
    const v = block[key];
    out[key] = (typeof v === 'string' && v.trim()) ? v.trim() : DEFAULT_DIRS[key];
  }
  return out;
}

// Absolute site dirs { pages, components, generators, assets, output } resolved against siteRoot,
// plus `.rel` (the site-relative strings, for messages).
function siteDirs(siteRoot, config) {
  const rel = dirNames(siteRoot, config);
  const abs = {};
  for (const key of Object.keys(rel)) abs[key] = path.join(siteRoot, rel[key]);
  abs.rel = rel;
  return abs;
}

module.exports = { siteDirs, dirNames, DEFAULT_DIRS };
