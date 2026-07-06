'use strict';
// Adopt the engine's bundled admin (catalog/admin) into a site as its own editable copy. Pure fs +
// config here; the CLI (cli.js `ssg add admin`) drives the overwrite prompt and the npm install. The
// admin then belongs to the site — resolved by `ssg admin` via `dirs.admin`, self-contained.

const fs = require('fs');
const path = require('path');
const { siteDirs } = require('./dirs');

// Recursively copy a directory tree (files + subdirs); returns the file count. Overwrites files that
// already exist (a --force re-adopt), leaving any extra site files in place.
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue; // never copy installed deps / vcs
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) count += copyDirSync(s, d);
    else { fs.copyFileSync(s, d); count++; }
  }
  return count;
}

// Where the admin should live: --folder overrides config `dirs.admin` (default shared/admin). Returns
// the absolute dir and a site-relative POSIX `rel` (what gets written to config.dirs.admin).
function adminTarget(siteRoot, config, folder) {
  let rel;
  if (folder && folder.trim()) {
    rel = path.relative(siteRoot, path.resolve(siteRoot, folder.trim())); // may be given relative or absolute
  } else {
    rel = siteDirs(siteRoot, config).rel.admin;
  }
  rel = rel.replace(/\\/g, '/');
  return { dir: path.resolve(siteRoot, rel), rel };
}

// Merge `dirs.admin` (repointed to `rel`) + a minimal `admin` block into config.json. Returns true if
// the file changed. The admin block is seeded only when absent, so re-adopting never clobbers settings.
function writeAdminConfig(siteRoot, rel) {
  const cfgPath = path.join(siteRoot, 'config.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) { config = {}; }
  let changed = false;
  if (!config.dirs || typeof config.dirs !== 'object') { config.dirs = {}; changed = true; }
  if (config.dirs.admin !== rel) { config.dirs.admin = rel; changed = true; }
  if (!config.admin || typeof config.admin !== 'object') {
    config.admin = { localhost_only: true, port: 3000 };
    changed = true;
  }
  if (changed) fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n');
  return changed;
}

module.exports = { copyDirSync, adminTarget, writeAdminConfig };
