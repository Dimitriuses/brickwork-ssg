'use strict';
// `ssg init --template <name>` — scaffold a starting project from a template repo's FILES (not its git
// history), never touching the target's own `.git`. The "degit" pattern: shallow-clone into a temp dir,
// copy everything **except** `.git` (the history) and top-level `engine/` (the submodule) into the
// target — per file, never clobbering unless force — then discard the temp. The engine is left as a
// submodule *reference* (`.gitmodules` is copied) for the user to wire; the automatic engine re-pin +
// a CI gate that builds the demo against engine `main` are deferred. See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// name -> repo URL. Only `demo` for now; the registry (tooling §3) generalises this.
const TEMPLATES = {
  demo: 'https://github.com/Dimitriuses/brickwork-demo.git'
};

// Copy src -> dest recursively, skipping the history (.git anywhere) and the top-level engine submodule.
// Never clobbers an existing target file unless force; honours dryRun. Records relative paths.
function copyTree(src, dest, rel, ctx) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === '.git') continue;                     // never copy git history
    if (rel === '' && entry.name === 'engine') continue;     // the engine is a submodule, not files
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d, relPath, ctx);
    } else {
      if (fs.existsSync(d) && !ctx.force) { ctx.skipped.push(relPath); continue; }
      if (!ctx.dryRun) {
        fs.mkdirSync(path.dirname(d), { recursive: true });
        fs.copyFileSync(s, d);
      }
      ctx.created.push(relPath);
    }
  }
}

// Scaffold `dir` from template `name` (git-clone its files). Returns { created, skipped, url }.
// Throws on an unknown template or a failed clone (e.g. offline).
function initFromTemplate(name, dir, { force = false, dryRun = false } = {}) {
  const url = TEMPLATES[name];
  if (!url) throw new Error(`unknown template "${name}" (available: ${Object.keys(TEMPLATES).join(', ')})`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwtmpl-'));
  const clone = path.join(tmp, 'repo');
  try {
    try {
      execSync(`git clone --depth 1 "${url}" "${clone}"`, { stdio: 'pipe' });
    } catch (e) {
      const detail = ((e.stderr || '') + '').trim() || e.message;
      throw new Error(`could not clone template "${name}" (${url}): ${detail}`);
    }
    const ctx = { force, dryRun, created: [], skipped: [] };
    copyTree(clone, dir, '', ctx);
    return { created: ctx.created, skipped: ctx.skipped, url };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
}

module.exports = { initFromTemplate, TEMPLATES };
