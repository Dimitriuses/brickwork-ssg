'use strict';
// Compute the component materials a site USES, via the same resolution the build uses (lib/components).
// Roots: every component referenced by a page (`components` arrays + `{{COMPONENT:x}}` + `layout`)
// plus the always-on header/footer/_layout; then closed over each component's dependencies + declared
// sub-components. Returns the used names and the distinct owning **folders** (a sub-component ships
// inside its parent's folder, so `--all-used` deploys folders, not sub-component names).
// See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');
const { createComponents } = require('./components');

const ALWAYS_ON = ['header', 'footer', '_layout']; // rendered on every page / the layout
const COMPONENT_RE = /\{\{COMPONENT:([a-zA-Z0-9_-]+)\}\}/g;

function usedComponentNames({ siteRoot, engineRoot, log }) {
  const C = createComponents({ siteRoot, engineRoot, log });
  const pagesDir = path.join(siteRoot, 'pages');
  const roots = new Set(ALWAYS_ON);

  // Scan every page folder for referenced components + its layout.
  if (fs.existsSync(pagesDir)) {
    for (const entry of fs.readdirSync(pagesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = path.join(pagesDir, entry.name, entry.name);

      const jsonFile = `${base}.json`;
      if (fs.existsSync(jsonFile)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
          (cfg.components || []).forEach(c => { if (c && c.name) roots.add(c.name); });
          if (cfg.layout) roots.add(cfg.layout);
        } catch (e) { /* a bad page config is the build's problem, not ours */ }
      }

      const htmlFile = `${base}.html`;
      if (fs.existsSync(htmlFile)) {
        const html = fs.readFileSync(htmlFile, 'utf8');
        let m;
        while ((m = COMPONENT_RE.exec(html))) roots.add(m[1]);
      }
    }
  }

  // Close over dependencies + declared sub-components (depth-first), like collectComponentAssets.
  const used = new Set();
  function add(name) {
    if (used.has(name)) return;
    used.add(name);
    const cfg = C.readComponentConfig(name);
    (cfg.dependencies || []).forEach(add);
    (cfg.subComponents || []).forEach(add);
  }
  for (const name of roots) add(name);

  // A sub-component lives in its parent's folder — deploy folders, not sub-component names.
  const folders = new Set([...used].map(name => C.componentFolder(name)));

  return { used: [...used].sort(), folders: [...folders].sort() };
}

module.exports = { usedComponentNames };
