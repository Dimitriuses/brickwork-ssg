'use strict';
// Component-resolution helpers, shared by the build and by `ssg add --all-used` so they see exactly
// the same graph (single source of truth). Bound to a site + engine root via a factory. Files resolve
// **site-first per file** (SITE/components before the engine's), sub-components live in their parent's
// folder, and a site may relocate a folder via components/registry.json. See docs/slim-core-plan.md.

const fs = require('fs');
const path = require('path');
const { siteDirs } = require('./dirs');

// createComponents({ siteRoot, engineRoot, engineComponentsDir?, log? }) -> resolution helpers.
// `engineComponentsDir` overrides the engine-side source dir: the BUILD resolves the engine's
// `components/` (empty under a slim core — the site must own what it uses), while `ssg add`/`--all-used`
// resolve the engine `catalog/` (the deployable source). `log` is optional ({ warn }); defaults to
// silent (e.g. when `ssg add` scans without a build logger).
function createComponents({ siteRoot, engineRoot, engineComponentsDir, log }) {
  const COMPONENTS_DIR = engineComponentsDir || path.join(engineRoot, 'components');
  const SITE_COMPONENTS = siteDirs(siteRoot).components; // configurable via config.json `dirs`
  const warn = (log && typeof log.warn === 'function') ? (msg, meta) => log.warn(msg, meta) : () => {};

  let _siteRegistry = null;
  function siteComponentRegistry() {
    if (_siteRegistry) return _siteRegistry;
    _siteRegistry = {};
    const file = path.join(SITE_COMPONENTS, 'registry.json');
    if (fs.existsSync(file)) {
      try {
        _siteRegistry = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      } catch (error) {
        warn(`Failed to parse components/registry.json: ${error.message}`, { phase: 'components' });
      }
    }
    return _siteRegistry;
  }

  // Sub-component -> parent-folder map, built by scanning every component's <name>.json for
  // "subComponents": [...] across both roots (cached). e.g. faq.json subComponents:[faqItem] => faqItem->faq.
  let _subcomponentMap = null;
  function subcomponentMap() {
    if (_subcomponentMap) return _subcomponentMap;
    _subcomponentMap = {};                  // set before scanning to avoid recursion
    for (const name of allComponentNames()) {
      for (const sub of (readComponentConfig(name).subComponents || [])) {
        _subcomponentMap[sub] = name;
      }
    }
    return _subcomponentMap;
  }

  // The folder (under a components/ dir) that owns a component's files: a sub-component lives in its
  // parent's folder, and a site registry.json entry relocates a top-level component — the same remap
  // resolveComponentFile applies to the site path, so componentFolder agrees with where files resolve.
  function componentFolder(name) {
    const folder = subcomponentMap()[name] || name;
    return siteComponentRegistry()[folder] || folder;
  }

  // Resolve one file of a component, site-first then engine; null if absent. A sub-component may live
  // in its own nested folder inside the parent (`<parent>/<subName>/<file>`); a flat file in the
  // parent folder (`<parent>/<subName>.<ext>`) still works (back-compat).
  function resolveComponentFile(name, filename) {
    const parent = subcomponentMap()[name]; // set only for sub-components
    const folder = parent || name;
    const siteFolder = siteComponentRegistry()[folder] || folder;
    const candidates = [];
    if (parent) {
      candidates.push(path.join(SITE_COMPONENTS, siteFolder, name, filename));
      candidates.push(path.join(COMPONENTS_DIR, folder, name, filename));
    }
    candidates.push(path.join(SITE_COMPONENTS, siteFolder, filename));
    candidates.push(path.join(COMPONENTS_DIR, folder, filename));
    for (const c of candidates) if (fs.existsSync(c)) return c;
    return null;
  }

  // A component's parsed JSON config ({ dependencies, subComponents, ... }), site-first.
  function readComponentConfig(name) {
    const file = resolveComponentFile(name, `${name}.json`);
    if (!file) return { dependencies: [] };
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      warn(`Failed to parse ${name}.json: ${error.message}`, { phase: 'components', logger: name });
      return { dependencies: [] };
    }
  }

  // Every component name known across both roots (and the site registry).
  function allComponentNames() {
    const names = new Set(Object.keys(siteComponentRegistry()));
    for (const root of [COMPONENTS_DIR, SITE_COMPONENTS]) {
      if (!fs.existsSync(root)) continue;
      for (const e of fs.readdirSync(root, { withFileTypes: true })) {
        if (e.isDirectory()) names.add(e.name);
      }
    }
    return [...names];
  }

  return {
    siteComponentRegistry,
    subcomponentMap,
    componentFolder,
    resolveComponentFile,
    readComponentConfig,
    allComponentNames
  };
}

module.exports = { createComponents };
