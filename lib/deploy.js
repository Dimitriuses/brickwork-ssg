'use strict';
// Material deployment primitive: copy a component from the engine's catalog into a site, per file.
// Each engine file is classified against the site's copy — copied (missing), skipped (identical), or
// drifted (present but differs from the engine's version; not overwritten unless `force`). The whole
// component folder is walked, so nested sub-component folders + bundled style.css/script.js come
// along. Powers `ssg add` and `ssg add --all-used`. See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');

// Files under `dir`, recursively, as `/`-joined paths relative to `dir` (sorted, stable).
function listFiles(dir) {
  const out = [];
  (function walk(cur, rel) {
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(cur, e.name), childRel);
      else if (e.isFile()) out.push(childRel);
    }
  })(dir, '');
  return out.sort();
}

function sameContent(a, b) {
  try { return fs.readFileSync(a).equals(fs.readFileSync(b)); } catch (e) { return false; }
}

// Deploy one component `name` from the engine catalog into a site.
//   opts: { engineComponentsDir, siteComponentsDir, destName?, force?, dryRun? }
// Returns { name, exists, copied:[], skipped:[], drifted:[] } (rel paths). `exists=false` means the
// engine has no such component — the caller reports that. `drifted` = files present in the site but
// differing from the engine's; left untouched unless `force`.
function deployMaterial(name, opts = {}) {
  const engineDir = path.join(opts.engineComponentsDir, name);
  const siteDir = path.join(opts.siteComponentsDir, opts.destName || name);
  const result = { name, exists: fs.existsSync(engineDir), copied: [], skipped: [], drifted: [] };
  if (!result.exists) return result;

  for (const rel of listFiles(engineDir)) {
    const src = path.join(engineDir, rel);
    const dest = path.join(siteDir, rel);
    if (!fs.existsSync(dest)) {
      if (!opts.dryRun) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); }
      result.copied.push(rel);
    } else if (sameContent(src, dest)) {
      result.skipped.push(rel);
    } else {
      if (opts.force && !opts.dryRun) fs.copyFileSync(src, dest);
      result.drifted.push(rel);
    }
  }
  return result;
}

module.exports = { deployMaterial, listFiles };
