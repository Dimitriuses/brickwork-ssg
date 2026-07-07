'use strict';
// Compute the component materials a site USES, via the same resolution the build uses (lib/components).
// Roots: every component referenced by a page (`components` arrays + `{{COMPONENT:x}}` + `layout`)
// plus the always-on `_layout`; then closed over each component's dependencies + declared
// sub-components. header/footer are not special-cased — they come in as `_layout`'s declared
// dependencies (_layout.json), so a layout that doesn't use them wouldn't force them. Returns the used
// names and the distinct owning **folders** (a sub-component ships inside its parent's folder, so
// `--all-used` deploys folders, not sub-component names). See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');
const { createComponents } = require('./components');
const { siteDirs } = require('./dirs');

const ALWAYS_ON = ['_layout']; // the layout wraps every page; header/footer arrive via its dependencies
const COMPONENT_RE = /\{\{COMPONENT:([a-zA-Z0-9_-]+)\}\}/g;

function usedComponentNames({ siteRoot, engineRoot, engineComponentsDir, log }) {
  // Deploy context: resolve site-first, then the engine CATALOG (the deployable source) — not the
  // build's (slim, empty) engine components/. So an inheriting site's used-set still closes over each
  // material's catalog-declared dependencies/sub-components.
  const catalogDir = engineComponentsDir || path.join(engineRoot, 'catalog');
  const C = createComponents({ siteRoot, engineRoot, engineComponentsDir: catalogDir, log });
  const pagesDir = siteDirs(siteRoot).pages; // configurable via config.json `dirs`
  const roots = new Set(ALWAYS_ON);

  const scanContent = (html) => {
    COMPONENT_RE.lastIndex = 0;
    let m;
    while ((m = COMPONENT_RE.exec(html))) roots.add(m[1]);
  };

  // Discover page configs the SAME way the build does: recursively (any .json under pages/, so a
  // nested page like pages/blog/post/post.json counts) — not just top-level pages/<dir>/<dir>.json.
  const configFiles = [];
  (function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.json')) configFiles.push(full);
    }
  })(pagesDir);

  for (const jsonFile of configFiles) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(jsonFile, 'utf8')); } catch (e) { continue; } // bad config is the build's problem
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;

    // Match the build's classification: a "_"-excluded NON-template page isn't built, so it isn't used.
    const isTemplate = !!cfg.generatorOptions;
    const excluded = path.relative(pagesDir, jsonFile).split(path.sep).some(seg => seg.startsWith('_'));
    if (excluded && !isTemplate) continue;

    (cfg.components || []).forEach(c => { if (c && c.name) roots.add(c.name); });
    // `layout` is a name string or a { name, vars } object (v0.6.4) — take the name.
    const layoutName = (cfg.layout && typeof cfg.layout === 'object') ? cfg.layout.name : cfg.layout;
    if (layoutName) roots.add(layoutName);

    // Resolve the content body the same way buildPage does (content_file → inline content → auto
    // <page>.html / <basename>.html beside the config) and scan it for inline {{COMPONENT:x}}.
    const dir = path.dirname(jsonFile);
    const basename = path.basename(jsonFile, '.json');
    if (cfg.content_file) {
      try { scanContent(fs.readFileSync(path.join(dir, cfg.content_file), 'utf8')); } catch (e) { /* missing is the build's problem */ }
    } else if (typeof cfg.content === 'string') {
      scanContent(cfg.content);
    } else {
      for (const name of new Set([cfg.page, basename].filter(f => typeof f === 'string' && f))) {
        const htmlFile = path.join(dir, `${name}.html`);
        if (fs.existsSync(htmlFile)) { try { scanContent(fs.readFileSync(htmlFile, 'utf8')); } catch (e) { /* ignore */ } }
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
