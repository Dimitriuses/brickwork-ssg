const fs = require('fs');
const path = require('path');
const { RawHtml, raw, escapeHtml } = require('./lib/html');
const { slugify } = require('./lib/slugify');
const { resolveGenerator } = require('./lib/generators');
const { globToRegExp } = require('./lib/glob');
const log = require('./lib/log');
const { createComponents } = require('./lib/components');
const { siteDirs, outputDirError } = require('./lib/dirs');

// Path roots. The engine (this script, components, lib, layout) is shared by
// every site; the site being built is the current working directory. Splitting
// these is what lets one engine build many sites - see docs/split-plan.md.
const ENGINE_ROOT = __dirname;
const SITE_ROOT = process.cwd();

// Engine-relative (shared across all sites)
const COMPONENTS_DIR = path.join(ENGINE_ROOT, 'components');
const GENERATORS_DIR = path.join(ENGINE_ROOT, 'generators');

// config.json is fixed at the site root (it bootstraps the layout below).
const CONFIG_FILE = path.join(SITE_ROOT, 'config.json');

// Load site configuration
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// Site-relative dirs, from config.json `dirs` (defaults to the conventional layout — see lib/dirs.js).
const DIRS = siteDirs(SITE_ROOT, config);
const PAGES_DIR = DIRS.pages;
const ASSETS_DIR = DIRS.assets;
const BUILD_DIR = DIRS.output;
const SITE_GENERATORS_DIR = DIRS.generators;
const SITE_COMPONENTS_DIR = DIRS.components;
const DATABASE_FILE = DIRS.database; // the collections DB (the `database` file entry in `dirs`)

// Load database configuration for collections
let database = { collections: [] };
if (fs.existsSync(DATABASE_FILE)) {
  database = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
}

// Deferred build warnings: collected during the build and printed grouped at the end (with a
// repeat-count and the action text) so guidance isn't lost mid-output. Now backed by lib/log.js —
// log.summary() flushes the grouped block. Thin wrapper keeps the existing call sites unchanged.
function deferWarning(message) {
  log.warn(message);
}

// Flatten config for easier variable replacement
// Support both flat and nested config formats
function flattenConfig(obj, prefix = '') {
  const flattened = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // Recursively flatten nested objects
      Object.assign(flattened, flattenConfig(value, prefix + key + '_'));
    } else {
      // Use uppercase with prefix for nested keys
      const flatKey = (prefix + key).toUpperCase();
      flattened[flatKey] = value;
    }
  }
  
  return flattened;
}

// Create both flat and original config
const flatConfig = flattenConfig(config);

// Also add common aliases for convenience
flatConfig.SITE_NAME = flatConfig.SITE_NAME || config.site?.name || 'My Website';
flatConfig.SITE_DESCRIPTION = flatConfig.SITE_DESCRIPTION || config.site?.description || '';
flatConfig.SITE_URL = flatConfig.SITE_URL || config.site?.url || '';
flatConfig.CONTACT_EMAIL = flatConfig.CONTACT_EMAIL || config.site?.contact?.email || '';
flatConfig.CONTACT_PHONE = flatConfig.CONTACT_PHONE || config.site?.contact?.phone || '';
flatConfig.YEAR = flatConfig.YEAR || new Date().getFullYear().toString();
flatConfig.COMPANY_NAME = flatConfig.COMPANY_NAME || flatConfig.SITE_NAME;

// Helper function to copy directory recursively
function copyDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// --- Component resolution (site-first, per file) ----------------------------
// A component's files (<name>.html, <name>.build.js, <name>.json, style.css,
// script.js) resolve per-file: SITE_ROOT/components first, then the engine. So
// a site can override one file (e.g. just the template, keeping the engine's
// build script) or ship a whole new component.
//
// Sub-components (faqItem, productCard) live in their parent's folder. A site
// may also relocate a component's folder via an optional registry,
// components/registry.json: { "<componentName>": "<folder under components/>" }.

// Component-resolution helpers now live in lib/components.js so `ssg add --all-used` resolves the
// graph exactly as the build does (single source of truth). Bound to this build's roots + logger.
const {
  siteComponentRegistry,
  subcomponentMap,
  componentFolder,
  resolveComponentFile,
  readComponentConfig,
  allComponentNames
} = createComponents({ siteRoot: SITE_ROOT, engineRoot: ENGINE_ROOT, log });

// Load a component template, resolving site overrides before the engine.
function loadComponent(componentName) {
  let file = resolveComponentFile(componentName, `${componentName}.html`);
  if (!file) {
    // Flat form (e.g. a component placed directly at <components>/<name>.html).
    for (const dir of [SITE_COMPONENTS_DIR, path.join(ENGINE_ROOT, 'components')]) {
      const flat = path.join(dir, `${componentName}.html`);
      if (fs.existsSync(flat)) { file = flat; break; }
    }
  }
  if (file) return fs.readFileSync(file, 'utf8');
  // Slim core: the engine ships no default components — a site owns what it uses. A miss is almost
  // always an un-installed material, so point at the fix rather than a bare "not found".
  throw new Error(`Component "${componentName}" is not installed — the site does not own it and the ` +
    `engine ships no defaults. If it is an engine material, run:  ssg add material ${componentName}`);
}

// Normalize backslashes to forward slashes inside web paths. Authors on Windows
// (or copy-pasted markup) sometimes write src="assets\images\x.png", which is an
// invalid URL. This rewrites only the values inside src="" / href="" attributes
// and CSS url(...) so the rest of the document (and any legitimate backslashes)
// is left untouched.
function normalizeWebPaths(html) {
  // src="..." and href="..." (single or double quoted)
  html = html.replace(/\b(src|href)=("|')([^"']*)\2/gi, (match, attr, quote, value) =>
    `${attr}=${quote}${value.replace(/\\/g, '/')}${quote}`);
  // CSS url(...) - optional surrounding quotes
  html = html.replace(/url\((\s*['"]?)([^'")]*)(['"]?\s*)\)/gi, (match, pre, value, post) =>
    `url(${pre}${value.replace(/\\/g, '/')}${post})`);
  return html;
}

// Helper function to replace {{VAR}} placeholders in a template.
// String/number values are HTML-escaped by default; wrap a value in raw()
// (from lib/html) to insert pre-built HTML verbatim. A function replacer is
// used so values containing $ sequences (e.g. "$&", "$1") are inserted
// literally rather than treated as regex replacement patterns.
function replaceVariables(template, vars) {
  let result = template;

  Object.entries(vars).forEach(([key, value]) => {
    // Skip arrays - they should be handled by component build scripts
    if (Array.isArray(value)) {
      return;
    }

    const replacement = value instanceof RawHtml ? value.value : escapeHtml(value);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g');
    result = result.replace(regex, () => replacement);
  });

  return result;
}

// Function to build a single component
function buildComponent(componentName, vars = {}, buildStack = []) {
  // Recursion protection - check if this component is already being built
  if (buildStack.includes(componentName)) {
    log.warn(`Circular dependency detected: ${buildStack.join(' -> ')} -> ${componentName}`, { phase: 'components', logger: componentName });
    return `<!-- Circular dependency: ${componentName} -->`;
  }
  
  // Add to build stack
  const newStack = [...buildStack, componentName];
  
  // Resolve the component's build script site-first: a site can supply its own
  // logic, or override only the template and keep the engine's build script.
  const buildScriptPath = resolveComponentFile(componentName, `${componentName}.build.js`);

  let html = '';

  if (buildScriptPath) {
    // Component has custom build logic
    const absolutePath = path.resolve(buildScriptPath);
    delete require.cache[absolutePath]; // Clear cache to allow rebuilds

    const buildScript = require(absolutePath);
    html = buildScript.build(vars, loadComponent, replaceVariables, {
      slugify, escapeHtml, raw, collection: collectionByName,
      // Scoped logger: a build script reports through log with its provenance auto-filled.
      log: log.scoped({ logger: 'component', source: `${componentName}.build.js`, phase: 'components' })
    });
  } else {
    // Standard template replacement
    const template = loadComponent(componentName);
    html = replaceVariables(template, vars);
  }
  
  // Resolve nested {{COMPONENT:xxx}} placeholders, skipping any inside an HTML comment — a
  // commented-out `<!-- {{COMPONENT:x}} -->` stays disabled. This mirrors the content pass in
  // buildPage, and matters because the layout is itself a component: this pass re-scans the injected
  // {{CONTENT}}, which may carry a commented placeholder buildPage deliberately left literal. The
  // callback replace (vs collect-then-string-replace) also keeps a non-commented `{{COMPONENT:x}}`
  // from being resolved into an *earlier* commented one of the same name.
  const commentRanges = [];
  for (const c of html.matchAll(/<!--[\s\S]*?-->/g)) {
    commentRanges.push([c.index, c.index + c[0].length]);
  }
  const insideComment = (i) => commentRanges.some(([s, e]) => i >= s && i < e);
  html = html.replace(/\{\{COMPONENT:([a-zA-Z0-9_-]+)\}\}/g, (placeholder, name, offset) => {
    if (insideComment(offset)) return placeholder; // commented-out reference, leave literal
    return buildComponent(name, vars, newStack);
  });
  
  return html;
}

// Final output page names seen this build, to catch collisions (two pages - normal
// or template-generated - resolving to the same <page>.html).
const builtPageNames = new Set();

// Function to build a page
function buildPage(pageConfig, pageName) {
  const pageData = typeof pageConfig === 'string'
    ? JSON.parse(fs.readFileSync(pageConfig, 'utf8'))
    : pageConfig;

  // Loud build-time check: a page name must be produced only once.
  if (builtPageNames.has(pageData.page)) {
    log.error(`page name collision: "${pageData.page}.html" is produced more than once`, { phase: 'pages' });
    buildErrors++;
  }
  builtPageNames.add(pageData.page);

  // The layout is a first-class component: it's built via buildComponent below (so it can carry a
  // <name>.build.js / subComponents / {{COMPONENT}} like any other), with CONTENT + the chrome
  // (HEADER/FOOTER/PAGE_TITLE/…) passed as its component vars.
  // `layout` may be a string (name) or a { name, vars } object — the same shape as a `components`
  // entry — so layout params (e.g. header_theme) group under it instead of scattering at the top level.
  const layoutConfig = pageData.layout;
  const layoutName = (layoutConfig && typeof layoutConfig === 'object' ? layoutConfig.name : layoutConfig) || '_layout';
  const layoutVars = (layoutConfig && typeof layoutConfig === 'object' && layoutConfig.vars && typeof layoutConfig.vars === 'object')
    ? layoutConfig.vars : {};

  // Build components
  let componentsHtml = '';
  const usedComponents = new Set(); // Track which components have been placed
  
  // Check for component placeholders in HTML content
  let contentHtml = '';
  
  // Try to load content from various sources
  if (pageData.content_file) {
    // Explicit content_file specified
    const pageDir = path.dirname(pageConfig);
    const contentPath = path.join(pageDir, pageData.content_file);
    if (fs.existsSync(contentPath)) {
      contentHtml = fs.readFileSync(contentPath, 'utf8');
    }
  } else if (pageData.content) {
    // Inline content in JSON
    contentHtml = pageData.content;
  } else {
    // Auto-detect: look for HTML file with same name as page
    const pageDir = path.dirname(pageConfig);
    const autoContentPath = path.join(pageDir, `${pageData.page}.html`);
    if (fs.existsSync(autoContentPath)) {
      contentHtml = fs.readFileSync(autoContentPath, 'utf8');
      log.debug(`  [CONTENT] Auto-loaded from ${pageData.page}.html`, { phase: 'pages' });
    }
  }
  
  if (pageData.components && pageData.components.length > 0) {
    log.debug(`  [COMPONENTS] Building ${pageData.components.length} component(s)`, { phase: 'pages' });
    
    pageData.components.forEach(comp => {
      const componentHtml = buildComponent(comp.name, comp.vars || {});
      
      // Check if component has a placeholder in content
      const placeholder = `{{COMPONENT:${comp.name}}}`;
      
      if (contentHtml.includes(placeholder)) {
        // Replace placeholder with component
        contentHtml = contentHtml.replace(placeholder, componentHtml);
        usedComponents.add(comp.name);
      } else if (!usedComponents.has(comp.name)) {
        // No placeholder found and not used yet - add to top
        componentsHtml += componentHtml + '\n';
        usedComponents.add(comp.name);
      }
    });
  }
  
  // Combine components and content
  let mainContent = componentsHtml + contentHtml;

  // Resolve any remaining {{COMPONENT:name}} placeholders in the content that
  // weren't tied to an entry in the page's `components` list - e.g. components
  // referenced directly inside a content template (like contactIcons in the
  // product-detail template). These render with the global flatConfig vars.
  // Placeholders inside HTML comments are left untouched so a commented-out
  // {{COMPONENT:faq}} stays disabled instead of being expanded.
  const commentRanges = [];
  const commentPattern = /<!--[\s\S]*?-->/g;
  let commentMatch;
  while ((commentMatch = commentPattern.exec(mainContent)) !== null) {
    commentRanges.push([commentMatch.index, commentMatch.index + commentMatch[0].length]);
  }
  const isInsideComment = (index) =>
    commentRanges.some(([start, end]) => index >= start && index < end);

  mainContent = mainContent.replace(/\{\{COMPONENT:([a-zA-Z0-9_-]+)\}\}/g, (match, name, offset) => {
    if (isInsideComment(offset)) return match; // commented-out placeholder, leave as-is
    try {
      return buildComponent(name, flatConfig);
    } catch (error) {
      log.warn(`Could not resolve {{COMPONENT:${name}}} in content: ${error.message}`, { phase: 'pages', logger: name });
      return match;
    }
  });

  // Collect all CSS files (including page-specific). `assetsFrom`, set on generated
  // pages from a template, links the template page's own asset.
  const cssFiles = collectComponentCSS(pageData.components || [], pageData.page, pageData.assetsFrom);
  const cssLinks = cssFiles.map(file =>
    `  <link href="${file}" rel="stylesheet">`
  ).join('\n');

  // Collect all JavaScript files (including page-specific)
  const jsFiles = collectComponentJS(pageData.components || [], pageData.page, pageData.assetsFrom);
  const jsScripts = jsFiles.map(file =>
    `  <script src="${file}"></script>`
  ).join('\n');
  
  // Replace layout variables
  const pageVars = {
    ...flatConfig,   // Spread flatConfig FIRST so it can be overridden
    ...layoutVars,   // the layout's own vars (grouped under `layout` in the page config) — e.g.
                     // `header_theme`, which the _layout component reads + turns into HEADER_MODE.
                     // The build stays out of layout-specific processing; it just forwards the vars.
    PAGE_TITLE: pageData.title || flatConfig.SITE_NAME,
    PAGE_DESCRIPTION: pageData.description || flatConfig.SITE_DESCRIPTION,
    SITE_NAME: flatConfig.SITE_NAME,
    CONTENT: raw(mainContent),
    // The collected component CSS <link> tags (in <head>) and JS <script> tags (end of <body>).
    // {{CSS_LINKS}}/{{JS_SCRIPTS}} are the self-describing names; {{HEAD_EXTRA}}/{{BODY_EXTRA}} are
    // kept as **deprecated aliases** (same value) so existing site layouts keep working — to be
    // dropped in a future release.
    CSS_LINKS: raw(cssLinks),
    JS_SCRIPTS: raw(jsScripts),
    HEAD_EXTRA: raw(cssLinks),
    BODY_EXTRA: raw(jsScripts)
  };
  
  const finalHtml = normalizeWebPaths(buildComponent(layoutName, pageVars));

  // Write output
  const outputFile = path.join(BUILD_DIR, `${pageData.page}.html`);
  fs.writeFileSync(outputFile, finalHtml);
  
  log.debug(`[BUILD] ${pageData.page}.html - "${pageData.title}"`, { phase: 'pages' });
}

// Resolve a single `map` value against a resolved collection item: a `$`-prefixed string is a
// data path into the item (`$data.name`, `$images`); anything else is a literal. A path whose
// deeper segment is absent is a "miss" (warn + ''); a bad root is caught by validateMapPaths.
function resolveMapValue(value, item) {
  if (typeof value !== 'string' || value[0] !== '$') return value; // literal
  let cur = item;
  for (const seg of value.slice(1).split('.')) {
    if (cur == null || typeof cur !== 'object' || !(seg in cur)) {
      deferWarning(`map path "${value}" resolved to nothing for some item(s)`);
      return '';
    }
    cur = cur[seg];
  }
  return cur;
}

// Build a vars object for a template from its `map` (placeholder -> $path/literal) and an item.
function resolveMap(map, item) {
  const vars = {};
  for (const [placeholder, value] of Object.entries(map)) vars[placeholder] = resolveMapValue(value, item);
  return vars;
}

// Resolve a template page's component `vars` $-paths against a per-item scope, so a generated
// page's components (e.g. a carousel taking `$images`) receive this item's data. No-op without an
// item (e.g. the generator path, unless a generator attaches `item` to its descriptor).
function resolveComponentVars(components, item) {
  if (!item) return components;
  return components.map(comp => (comp && comp.vars) ? { ...comp, vars: resolveMap(comp.vars, item) } : comp);
}

// Build-time check: every `$`-path in a map must root at a known data_model part.
function validateMapPaths(map, partNames, label) {
  const errors = [];
  for (const [placeholder, value] of Object.entries(map)) {
    if (typeof value === 'string' && value[0] === '$') {
      const root = value.slice(1).split('.')[0];
      if (!partNames.includes(root)) {
        errors.push(`Template ${label}: map "${placeholder}" -> "${value}" references unknown part "${root}" (collection parts: ${partNames.join(', ') || 'none'})`);
      }
    }
  }
  return errors;
}

// Expand a TEMPLATE page (one carrying generatorOptions) into one built page per
// item. Resolves the named generator, runs its data-only generate(ctx, options),
// then for each item fills the template HTML with item.vars and builds it via
// buildPage. The template's own folder asset is linked through `assetsFrom`.
// Generator contract (Phase 2):
//   module.exports = { generate(ctx, options) -> [{ slug, title, description, vars }] }
//   ctx = { siteRoot, engineRoot, buildDir, lib:{slugify,escapeHtml,raw}, collection:{dir,webPath} }
function expandTemplatePage(templateFile, templateConfig) {
  const opts = templateConfig.generatorOptions || {};
  const label = path.basename(templateFile);
  const fail = (message) => { log.error(`Template ${label}: ${message}`, { phase: 'templates' }); buildErrors++; return 0; };

  // Validate generatorOptions (loud, build-failing). `generator` is optional: without it the
  // engine's built-in path renders one page per collection item via `map`.
  if (!opts.pageName) return fail('generatorOptions.pageName is required');

  let generatorPath = null;
  if (opts.generator) {
    generatorPath = resolveGenerator(opts.generator, {
      engineGeneratorsDir: GENERATORS_DIR,
      siteGeneratorsDir: SITE_GENERATORS_DIR
    });
    if (!generatorPath) return fail(`unknown generator "${opts.generator}" (check generators/registry.json)`);
  } else if (!opts.source) {
    return fail('generatorOptions needs a `generator` or a `source` (the built-in path renders from a collection)');
  }

  // Resolve + validate the source collection (when one is named). The engine pre-resolves the
  // items (data_model -> { id, item }) and hands them on ctx.collection alongside the raw
  // dir/webPath (kept for custom generators that want to scan beyond the model).
  let collection = null;
  let ctxCollection = { options: opts, dir: null, webPath: null, items: [] };
  if (opts.source) {
    collection = (database.collections || []).find(c => c.name === opts.source);
    if (!collection) return fail(`source collection "${opts.source}" not found in database.json`);
    if (!collection.enabled) return fail(`source collection "${opts.source}" is disabled`);
    ctxCollection = {
      options: opts,
      dir: path.join(BUILD_DIR, collection.destination),
      webPath: collection.destination,
      items: resolveCollectionItems(collection)
    };
  }

  const ctx = {
    siteRoot: SITE_ROOT,
    engineRoot: ENGINE_ROOT,
    buildDir: BUILD_DIR,
    lib: { slugify, escapeHtml, raw },
    collection: ctxCollection
  };

  // Descriptors come from the named generator, or - generator-free - from the engine's built-in
  // path: one descriptor per collection item, vars filled from `generatorOptions.map`.
  let descriptors;
  if (generatorPath) {
    delete require.cache[generatorPath];
    const mod = require(generatorPath);
    if (typeof mod.generate !== 'function') {
      log.error(`Generator "${opts.generator}" has no generate(ctx, options) export`, { phase: 'templates' });
      buildErrors++;
      return 0;
    }
    descriptors = mod.generate(ctx, opts) || [];
  } else {
    const partNames = Object.keys((collection && collection.data_model) || {});
    const mapErrors = validateMapPaths(opts.map || {}, partNames, label);
    // Component vars resolve against the item too, so validate their $-paths the same way.
    (templateConfig.components || []).forEach(comp => {
      validateMapPaths(comp.vars || {}, partNames, label).forEach(m => mapErrors.push(m));
    });
    if (mapErrors.length) {
      mapErrors.forEach(m => log.error(m, { phase: 'templates' }));
      buildErrors += mapErrors.length;
      return 0;
    }
    descriptors = ctxCollection.items.map(({ id, item }) => ({
      slug: id,
      title: (item.data && item.data.name) || id,
      description: (item.data && item.data.description) || '',
      vars: resolveMap(opts.map || {}, item),
      item
    }));
  }

  // Template HTML lives beside the config: <dir>/<name>.html. Filled per item.
  const templateDir = path.dirname(templateFile);
  const htmlPath = path.join(templateDir, `${path.basename(templateFile, '.json')}.html`);
  const templateHtml = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '';
  const assetsFrom = path.basename(templateDir); // template folder owns the page asset

  let built = 0;
  descriptors.forEach(descriptor => {
    const pageName = String(opts.pageName || '{slug}').replace(/\{slug\}/g, descriptor.slug);
    const pageConfig = {
      page: pageName,
      title: descriptor.title,
      description: descriptor.description,
      layout: templateConfig.layout || '_layout',   // carries the template's layout vars (header_theme, …)
      components: resolveComponentVars(templateConfig.components || [], descriptor.item),
      content: replaceVariables(templateHtml, descriptor.vars || {}),
      assetsFrom
    };
    buildPage(pageConfig, pageName);
    built++;
  });
  log.info(`[TEMPLATE] ${path.basename(templateDir)}: built ${built} page(s) via "${opts.generator || 'built-in map'}"`, { phase: 'templates' });
  return built;
}

// Collect the CSS/JS files a page needs: global, each used component (with its
// dependencies, depth-first) plus the always-present base components, and any
// page-specific asset. `kind` is 'css' or 'js'; they differ only in the source
// filename and which base components are always included.
const ASSET_KINDS = {
  css: { sourceFile: 'style.css', base: ['_layout'] },
  js: { sourceFile: 'script.js', base: ['_layout'] }
};

function collectComponentAssets(kind, components, pageName, assetBase) {
  const { sourceFile, base } = ASSET_KINDS[kind];
  const files = [`assets/${kind}/global.${kind}`];
  const added = new Set();

  function addComponent(compName) {
    if (added.has(compName)) return;
    added.add(compName);

    // Dependencies and declared sub-components first (depth-first), then this component's own
    // asset - all resolved site-first. Sub-components get their own bundled asset when used.
    (readComponentConfig(compName).dependencies || []).forEach(addComponent);
    (readComponentConfig(compName).subComponents || []).forEach(addComponent);

    if (resolveComponentFile(compName, sourceFile)) {
      files.push(`assets/${kind}/${compName}.${kind}`);
    }
  }

  // Always-present base components, then the page's own components.
  base.forEach(addComponent);
  (components || []).forEach(comp => addComponent(comp.name));

  // Page-specific asset: a template-driven generated page links its template page's
  // own asset (assetBase = the template folder); a normal page links its own folder's
  // asset. Either is copied from the page folder by copyComponentAssets, which names
  // the file after the folder with any leading "_" stripped.
  const assetFolder = assetBase || pageName;
  if (assetFolder && fs.existsSync(path.join(PAGES_DIR, assetFolder, sourceFile))) {
    files.push(`assets/${kind}/pages/${assetFolder.replace(/^_/, '')}.${kind}`);
  }

  return files;
}

const collectComponentCSS = (components, pageName, assetBase) => collectComponentAssets('css', components, pageName, assetBase);
const collectComponentJS = (components, pageName, assetBase) => collectComponentAssets('js', components, pageName, assetBase);

// Copy assets of one kind ('css' or 'js') into build/: the global file, every
// component's asset, and each page folder's asset (named after the folder, leading
// "_" stripped). Template-driven pages link their template folder's asset from here.
function copyComponentAssets(kind) {
  const { sourceFile } = ASSET_KINDS[kind];
  const buildAssetDir = path.join(BUILD_DIR, 'assets', kind);
  const buildPagesAssetDir = path.join(buildAssetDir, 'pages');

  if (!fs.existsSync(buildAssetDir)) fs.mkdirSync(buildAssetDir, { recursive: true });
  if (!fs.existsSync(buildPagesAssetDir)) fs.mkdirSync(buildPagesAssetDir, { recursive: true });

  // Global asset
  const globalAsset = path.join(ASSETS_DIR, kind, `global.${kind}`);
  if (fs.existsSync(globalAsset)) {
    fs.copyFileSync(globalAsset, path.join(buildAssetDir, `global.${kind}`));
  }

  // Component assets (engine + site; site overrides win, registry-relocated too), plus each
  // component's declared sub-components (which may carry their own nested assets).
  allComponentNames().forEach(compName => {
    const assetFile = resolveComponentFile(compName, sourceFile);
    if (assetFile) {
      fs.copyFileSync(assetFile, path.join(buildAssetDir, `${compName}.${kind}`));
    }
    (readComponentConfig(compName).subComponents || []).forEach(subName => {
      const subAsset = resolveComponentFile(subName, sourceFile);
      if (subAsset) {
        fs.copyFileSync(subAsset, path.join(buildAssetDir, `${subName}.${kind}`));
      }
    });
  });

  // Site page-specific assets (top-level page folders only)
  fs.readdirSync(PAGES_DIR, { withFileTypes: true }).forEach(entry => {
    if (!entry.isDirectory()) return;
    const pageAssetFile = path.join(PAGES_DIR, entry.name, sourceFile);
    if (fs.existsSync(pageAssetFile)) {
      const fileName = entry.name.replace(/^_/, '') + `.${kind}`;
      fs.copyFileSync(pageAssetFile, path.join(buildPagesAssetDir, fileName));
    }
  });
}

const copyComponentCSS = () => copyComponentAssets('css');
const copyComponentJS = () => copyComponentAssets('js');

// Validate a collection's data_model shape (build-time, loud). Returns a list of error
// strings; empty means valid.
function validateDataModel(collection) {
  const model = collection.data_model;
  if (typeof model !== 'object' || model === null || Array.isArray(model)) {
    return ['data_model must be an object keyed by part name'];
  }
  const errors = [];
  for (const [name, part] of Object.entries(model)) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      errors.push(`part "${name}" must be an object`);
      continue;
    }
    if (typeof part.match !== 'string' || part.match.trim() === '') {
      errors.push(`part "${name}" needs a non-empty string "match"`);
    } else if ((part.match.match(/\{/g) || []).length !== (part.match.match(/\}/g) || []).length) {
      errors.push(`part "${name}": unbalanced { } in match "${part.match}"`);
    }
    if ('copy' in part && typeof part.copy !== 'boolean') errors.push(`part "${name}": "copy" must be a boolean`);
    if ('required' in part && typeof part.required !== 'boolean') errors.push(`part "${name}": "required" must be a boolean`);
  }
  return errors;
}

// Recursively list files under a folder as paths relative to it (forward slashes).
function listFilesRelative(dir, rel = '') {
  const out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFilesRelative(path.join(dir, entry.name), relPath));
    else out.push(relPath);
  });
  return out;
}

// Copy a collection whose items declare a `data_model`. **`copy` defaults false** (safe by
// default): a file ships only if a part with `copy: true` matches it; everything else (parts
// with `copy: false`, parts that omit `copy`, and undeclared files) stays out of build/. Globs
// are item-relative; items are the immediate subfolders of the source. A `required: true` part
// with no matching file in an item is a loud build error.
function copyCollectionByModel(collection, sourcePath, destPath) {
  const parts = Object.entries(collection.data_model).map(([name, p]) => {
    if (!('copy' in p)) {
      deferWarning(`collection "${collection.name}" part "${name}": no \`copy\` - its files will NOT ship to build/; set \`copy: true\` to ship or \`copy: false\` to silence`);
    }
    return { name, match: p.match, regex: globToRegExp(p.match), copy: p.copy === true, required: p.required === true };
  });
  const shouldCopy = (relPath) => parts.some(p => p.copy && p.regex.test(relPath));
  const requiredParts = parts.filter(p => p.required);

  let itemCount = 0;
  fs.readdirSync(sourcePath, { withFileTypes: true }).forEach(entry => {
    const src = path.join(sourcePath, entry.name);
    const dest = path.join(destPath, entry.name);
    if (entry.isDirectory()) {
      itemCount++;
      const files = listFilesRelative(src);
      requiredParts.forEach(rp => {
        if (!files.some(f => rp.regex.test(f))) {
          log.error(`${collection.name}/${entry.name}: required "${rp.name}" (match ${rp.match}) not found`, { phase: 'collections', logger: collection.name });
          buildErrors++;
        }
      });
      files.forEach(rel => {
        if (!shouldCopy(rel)) return;
        const fdest = path.join(dest, rel);
        fs.mkdirSync(path.dirname(fdest), { recursive: true });
        fs.copyFileSync(path.join(src, rel), fdest);
      });
    } else if (shouldCopy(entry.name)) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  });
  log.info(`  [MODEL]  ${collection.name}: ${collection.source} → ${collection.destination} (${itemCount} item(s))`, { phase: 'collections' });
}

// Resolve a collection's items from its source folder via the data_model, surfacing each part
// per its `type`: `object` (first match parsed), `paths` (matched files -> web paths), or
// `file_path` (first match -> a web path). Returns [{ id, item }] where item is keyed by part
// name. `id` (the {slug}) is the item folder, overridden by item.data.slug; both slugified.
// Reads from the SOURCE (not build/), so it is independent of the `copy` flags. Cached per
// collection (a collection used by several template pages resolves - and warns - only once).
const _resolvedCollections = new Map();
function resolveCollectionItems(collection) {
  if (_resolvedCollections.has(collection.name)) return _resolvedCollections.get(collection.name);
  const sourcePath = path.join(SITE_ROOT, collection.source);
  if (!fs.existsSync(sourcePath)) return [];
  const model = collection.data_model || {};
  if (!collection.data_model) {
    deferWarning(`collection "${collection.name}" is used by a template but has no data_model - ctx.collection.items will be empty; add a data_model to surface item data/images`);
  }

  // Per-part setup; omitted `type`/`required` warn once (grouped at the end).
  const parts = Object.entries(model).map(([name, part]) => {
    if (!('type' in part)) {
      deferWarning(`collection "${collection.name}" part "${name}": no \`type\` - defaulting to file_path; set \`type\` (object/paths/file_path) if that's wrong`);
    }
    if (!('required' in part)) {
      deferWarning(`collection "${collection.name}" part "${name}": no \`required\` - defaulting to false; set \`required\` explicitly`);
    }
    return { name, regex: globToRegExp(part.match), type: part.type || 'file_path' };
  });

  const items = [];
  fs.readdirSync(sourcePath, { withFileTypes: true }).filter(e => e.isDirectory()).forEach(entry => {
    const folder = entry.name;
    const itemDir = path.join(sourcePath, folder);
    const files = listFilesRelative(itemDir).sort();
    const webPath = (rel) => `${collection.destination}/${folder}/${rel}`;
    const item = {};

    parts.forEach(part => {
      const matched = files.filter(f => part.regex.test(f));
      if (part.type === 'object') {
        item[part.name] = matched.length ? readJsonSafe(path.join(itemDir, matched[0]), `${collection.name}/${folder}/${matched[0]}`) : null;
      } else if (part.type === 'paths') {
        item[part.name] = matched.map(webPath);
      } else { // file_path
        if (matched.length > 1) {
          deferWarning(`collection "${collection.name}" part "${part.name}": file_path matched ${matched.length} files in "${folder}" - using the first`);
        }
        item[part.name] = matched.length ? webPath(matched[0]) : null;
      }
    });

    const slugBase = (item.data && typeof item.data === 'object' && item.data.slug) || folder;
    items.push({ id: slugify(String(slugBase)), item });
  });
  _resolvedCollections.set(collection.name, items);
  return items;
}

// Component build-script accessor (exposed via the helpers arg as `collection`): resolve a
// collection's items by name - the same data the generators see via ctx.collection.items - so a
// component can read the data model instead of raw files (which `copy: false` keeps out of build/).
// Returns { name, destination, items: [{ id, item }] }, or null (+ warning) for an unknown name.
function collectionByName(name) {
  const collection = (database.collections || []).find(c => c.name === name);
  if (!collection) {
    deferWarning(`a component requested unknown collection "${name}" - check the name against database.json`);
    return null;
  }
  return {
    name: collection.name,
    destination: collection.destination,
    items: resolveCollectionItems(collection)
  };
}

// Parse a JSON file; on failure defer a warning and return null (resolution continues).
function readJsonSafe(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    deferWarning(`could not parse ${label}: ${error.message}`);
    return null;
  }
}

// Function to copy collections (products, custom items, etc.) based on database.json
function copyCollections() {
  if (!database.collections || database.collections.length === 0) {
    log.info('[COLLECTIONS] No collections configured in database.json', { phase: 'collections' });
    return;
  }

  const enabledCollections = database.collections.filter(c => c.enabled);

  if (enabledCollections.length === 0) {
    log.info('[COLLECTIONS] No enabled collections found', { phase: 'collections' });
    return;
  }

  log.info(`[COLLECTIONS] Found ${enabledCollections.length} enabled collection(s)`, { phase: 'collections' });

  enabledCollections.forEach(collection => {
    const sourcePath = path.join(SITE_ROOT, collection.source);
    const destPath = path.join(BUILD_DIR, collection.destination);

    if (!fs.existsSync(sourcePath)) {
      log.error(`${collection.name}: Source not found (${collection.source})`, { phase: 'collections', logger: collection.name });
      return;
    }

    if (!collection.data_model) {
      // Back-compat: copy the whole collection, but nudge toward declaring a data_model
      // so the engine knows which parts are web assets vs data (leak control).
      copyDirectory(sourcePath, destPath);
      log.info(`  [FOLDER] ${collection.name}: ${collection.source} → ${collection.destination}`, { phase: 'collections' });
      log.warn(`${collection.name}: no data_model - copying the whole collection; declare one to control which parts ship to build/`, { phase: 'collections', logger: collection.name });
      return;
    }

    const modelErrors = validateDataModel(collection);
    if (modelErrors.length) {
      modelErrors.forEach(m => log.error(`${collection.name}: ${m}`, { phase: 'collections', logger: collection.name }));
      buildErrors += modelErrors.length;
      return; // don't copy with a broken data_model
    }

    copyCollectionByModel(collection, sourcePath, destPath);
  });

  log.info('', { phase: 'collections' });
}

// Main build process
log.info('========================================', { phase: 'build' });
log.info('Starting website build process...', { phase: 'build' });
log.info(`Time: ${new Date().toLocaleString()}`, { phase: 'build' });
log.info('========================================\n', { phase: 'build' });

const buildStart = Date.now();
let buildErrors = 0;  // any generator/page failure makes the build exit non-zero

// Guard the destructive wipe: a mis-set `dirs.output` (".", "..", "pages", …) would delete site
// source. Validate the resolved output dir BEFORE the rmSync and abort loudly if it is unsafe.
const outputErr = outputDirError(SITE_ROOT, config);
if (outputErr) {
  log.error(outputErr, { phase: 'build' });
  log.summary({ pagesBuilt: 0, errors: 1, elapsedMs: Date.now() - buildStart });
  process.exit(1);
}

// Clean build directory
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Copy assets (excluding CSS and JS which we handle separately). Guard the copy: a minimal/fresh
// site (e.g. one just made by `ssg init`) may have no assets/images/ yet — skip rather than ENOENT.
const imagesDir = path.join(ASSETS_DIR, 'images');
if (fs.existsSync(imagesDir)) {
  copyDirectory(imagesDir, path.join(BUILD_DIR, 'assets', 'images'));
  log.info('[ASSETS] Copied images to build/assets/', { phase: 'assets' });
}

// Copy component CSS and JS
copyComponentCSS();
log.info('[CSS] Component styles copied to build/assets/css/', { phase: 'assets' });

copyComponentJS();
log.info('[JS] Component scripts copied to build/assets/js/\n', { phase: 'assets' });

// Copy collections (products, custom items, etc.) from shared folder
copyCollections();

// Page generation is driven by TEMPLATE pages (configs carrying generatorOptions),
// discovered in the page scan below and expanded via expandTemplatePage. The legacy
// auto-run dispatch (scan generators/*.build.js and run each) has been removed - a
// generator now runs only when a template page references it by name.

// Build all pages
const pageFiles = [];

// Recursively find all .json configs under pages/. Underscore-prefixed files and
// folders are NOT skipped here: a template page (one with generatorOptions) is found
// regardless of any "_" (the "_" is just an author comment). Underscore-prefixed
// NON-template pages are excluded later, during classification.
function findPageFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findPageFiles(fullPath);
    } else if (entry.name.endsWith('.json')) {
      pageFiles.push(fullPath);
    }
  });
}

findPageFiles(PAGES_DIR);

// Classify each scanned config:
//  - `generatorOptions` present        => TEMPLATE page (expanded per item, not built
//                                          literally); found regardless of any "_".
//  - else a "_"-prefixed path segment  => excluded (examples/drafts/template internals;
//                                          the "_" is an author comment, never emitted).
//  - else                              => normal page.
const normalPageFiles = [];
const templatePages = [];
for (const pageFile of pageFiles) {
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(pageFile, 'utf8'));
  } catch (error) {
    log.error(`Failed to parse ${pageFile}: ${error.message}`, { phase: 'pages' });
    buildErrors++;
    continue;
  }
  if (cfg && cfg.generatorOptions) {
    templatePages.push({ file: pageFile, config: cfg });
    continue;
  }
  const excluded = path.relative(PAGES_DIR, pageFile).split(path.sep).some(seg => seg.startsWith('_'));
  if (!excluded) normalPageFiles.push(pageFile);
}

log.info(`[PAGES] Found ${normalPageFiles.length} page(s) + ${templatePages.length} template(s)\n`, { phase: 'pages' });

let pagesBuilt = 0;
normalPageFiles.forEach(pageFile => {
  try {
    const pageName = path.basename(pageFile, '.json');
    buildPage(pageFile, pageName);
    pagesBuilt++;
  } catch (error) {
    log.error(`Failed to build ${pageFile}: ${error.message}`, { phase: 'pages' });
    buildErrors++;
  }
});

// Expand each template page into one built page per item (data-only generator).
templatePages.forEach(({ file, config }) => {
  try {
    pagesBuilt += expandTemplatePage(file, config);
  } catch (error) {
    log.error(`Failed to expand template ${path.basename(file)}: ${error.message}`, { phase: 'templates' });
    buildErrors++;
  }
});

// Surface unresolved {{VAR}} placeholders at build time — a warning (not fatal); `ssg test` still
// *fails* on them (lib/checks.js). Comments are stripped first (as in checks.js) so a commented-out
// placeholder/example is ignored; a *visible* `{{COMPONENT:..}}` would already have failed component
// resolution, so this catches the plain-`{{VAR}}` gap (e.g. a `{{HEADER}}` left after a rename).
const unresolvedIn = [];
const unresolvedVars = new Set();
for (const rel of listFilesRelative(BUILD_DIR).filter(f => f.endsWith('.html'))) {
  const visible = fs.readFileSync(path.join(BUILD_DIR, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const found = visible.match(/\{\{[A-Za-z0-9_]+\}\}/g);
  if (found) { unresolvedIn.push(rel); found.forEach(v => unresolvedVars.add(v)); }
}
if (unresolvedIn.length) {
  const vars = [...unresolvedVars].slice(0, 5).join(', ') + (unresolvedVars.size > 5 ? ', …' : '');
  const pages = unresolvedIn.slice(0, 5).join(', ') + (unresolvedIn.length > 5 ? ', …' : '');
  log.warn(`Unresolved placeholder(s) ${vars} left literal in ${unresolvedIn.length} page(s): ${pages}. ` +
    '`ssg test` fails on these.', { phase: 'pages' });
}

// Reconcile the error tally with the logger's own count: the logger owns the truth (some log.error
// call sites — e.g. a missing collection source — don't touch buildErrors), so any error emitted
// through log fails the build even if a call site forgot to bump the local counter.
const errorCount = Math.max(buildErrors, log.errorCount);

// Flush the grouped warnings, then the verdict — coloured by outcome (traffic-light), text
// byte-identical to before when colour is off (e.g. piped/CI).
log.summary({
  pagesBuilt,
  errors: errorCount,
  elapsedMs: Date.now() - buildStart,
  outputDir: `${path.relative(SITE_ROOT, BUILD_DIR)}/`
});
// Non-zero exit so CI / scripts fail loudly instead of shipping a broken site.
if (errorCount > 0) process.exitCode = 1;
