const fs = require('fs');
const path = require('path');
const { RawHtml, raw, escapeHtml } = require('./lib/html');
const { slugify } = require('./lib/slugify');

// Path roots. The engine (this script, components, lib, layout) is shared by
// every site; the site being built is the current working directory. Splitting
// these is what lets one engine build many sites - see docs/split-plan.md.
const ENGINE_ROOT = __dirname;
const SITE_ROOT = process.cwd();

// Engine-relative (shared across all sites)
const COMPONENTS_DIR = path.join(ENGINE_ROOT, 'components');
const GENERATORS_DIR = path.join(ENGINE_ROOT, 'generators');

// Site-relative (per-site content, data and output)
const PAGES_DIR = path.join(SITE_ROOT, 'pages');
const ASSETS_DIR = path.join(SITE_ROOT, 'assets');
const BUILD_DIR = path.join(SITE_ROOT, 'build');
const CONFIG_FILE = path.join(SITE_ROOT, 'config.json');
const DATABASE_FILE = path.join(SITE_ROOT, 'shared', 'database.json');
// Scratch dir for page JSON emitted by generators. Lives under build/ so it is
// wiped with each run, and is removed again before the build finishes so it is
// never shipped. Keeps generated artifacts out of the pages/ source tree.
const GENERATED_PAGES_DIR = path.join(BUILD_DIR, '_generated-pages');

// Load site configuration
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

// Load database configuration for collections
let database = { collections: [] };
if (fs.existsSync(DATABASE_FILE)) {
  database = JSON.parse(fs.readFileSync(DATABASE_FILE, 'utf8'));
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

let _siteRegistry = null;
function siteComponentRegistry() {
  if (_siteRegistry) return _siteRegistry;
  _siteRegistry = {};
  const file = path.join(SITE_ROOT, 'components', 'registry.json');
  if (fs.existsSync(file)) {
    try {
      _siteRegistry = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    } catch (error) {
      console.log('  [WARNING] Failed to parse components/registry.json:', error.message);
    }
  }
  return _siteRegistry;
}

// Sub-component -> parent-folder map, built by scanning every component's
// <name>.json for "subComponents": [...] across both roots (cached per build).
// e.g. components/faq/faq.json { "subComponents": ["faqItem"] } => faqItem -> faq.
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

// The folder (under a components/ dir) that owns a component's files.
function componentFolder(name) {
  return subcomponentMap()[name] || name;
}

// Resolve one file of a component, site-first then engine; null if absent.
function resolveComponentFile(name, filename) {
  const folder = componentFolder(name);
  const siteFolder = siteComponentRegistry()[folder] || folder;
  const candidates = [
    path.join(SITE_ROOT, 'components', siteFolder, filename),
    path.join(COMPONENTS_DIR, folder, filename)
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// A component's parsed JSON config ({ dependencies, ... }), site-first.
function readComponentConfig(name) {
  const file = resolveComponentFile(name, `${name}.json`);
  if (!file) return { dependencies: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.log(`  [WARNING] Failed to parse ${name}.json:`, error.message);
    return { dependencies: [] };
  }
}

// Every component name known across both roots (and the site registry).
function allComponentNames() {
  const names = new Set(Object.keys(siteComponentRegistry()));
  for (const root of [COMPONENTS_DIR, path.join(SITE_ROOT, 'components')]) {
    if (!fs.existsSync(root)) continue;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (e.isDirectory()) names.add(e.name);
    }
  }
  return [...names];
}

// Load a component template, resolving site overrides before the engine.
function loadComponent(componentName) {
  let file = resolveComponentFile(componentName, `${componentName}.html`);
  if (!file) {
    // Flat form (e.g. a component placed directly at components/<name>.html).
    for (const root of [SITE_ROOT, ENGINE_ROOT]) {
      const flat = path.join(root, 'components', `${componentName}.html`);
      if (fs.existsSync(flat)) { file = flat; break; }
    }
  }
  if (file) return fs.readFileSync(file, 'utf8');
  throw new Error(`Component not found: ${componentName}`);
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
    console.log(`  [WARNING] Circular dependency detected: ${buildStack.join(' -> ')} -> ${componentName}`);
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
    html = buildScript.build(vars, loadComponent, replaceVariables, { slugify, escapeHtml, raw });
  } else {
    // Standard template replacement
    const template = loadComponent(componentName);
    html = replaceVariables(template, vars);
  }
  
  // Resolve nested {{COMPONENT:xxx}} placeholders
  const componentPattern = /\{\{COMPONENT:([a-zA-Z0-9_-]+)\}\}/g;
  let match;
  const matches = [];
  
  // Collect all matches first to avoid regex issues
  while ((match = componentPattern.exec(html)) !== null) {
    matches.push({ placeholder: match[0], name: match[1] });
  }
  
  // Replace each nested component
  matches.forEach(({ placeholder, name }) => {
    const nestedComponentHtml = buildComponent(name, vars, newStack);
    html = html.replace(placeholder, nestedComponentHtml);
  });
  
  return html;
}

// Function to build a page
function buildPage(pageConfig, pageName) {
  const pageData = typeof pageConfig === 'string' 
    ? JSON.parse(fs.readFileSync(pageConfig, 'utf8'))
    : pageConfig;
  
  // Load layout
  const layout = loadComponent(pageData.layout || '_layout');
  
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
      console.log(`  [CONTENT] Auto-loaded from ${pageData.page}.html`);
    }
  }
  
  if (pageData.components && pageData.components.length > 0) {
    console.log(`  [COMPONENTS] Building ${pageData.components.length} component(s)`);
    
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
      console.log(`  [WARNING] Could not resolve {{COMPONENT:${name}}} in content:`, error.message);
      return match;
    }
  });

  // Build header based on theme
  const headerMode = pageData.header_theme || 'light';
  // const headerTemplate = headerMode === 'dark' ? 'header-dark' : 'header-light';
  const headerHtml = buildComponent("header", flatConfig);
  
  // Build footer
  const footerHtml = buildComponent('footer', flatConfig);
  
  // Collect all CSS files (including page-specific)
  const cssFiles = collectComponentCSS(pageData.components || [], pageData.page);
  const cssLinks = cssFiles.map(file => 
    `  <link href="${file}" rel="stylesheet">`
  ).join('\n');
  
  // Collect all JavaScript files (including page-specific)
  const jsFiles = collectComponentJS(pageData.components || [], pageData.page);
  const jsScripts = jsFiles.map(file =>
    `  <script src="${file}"></script>`
  ).join('\n');
  
  // Replace layout variables
  const pageVars = {
    ...flatConfig,  // Spread flatConfig FIRST so it can be overridden
    PAGE_TITLE: pageData.title || flatConfig.SITE_NAME,
    PAGE_DESCRIPTION: pageData.description || flatConfig.SITE_DESCRIPTION,
    SITE_NAME: flatConfig.SITE_NAME,
    HEADER: raw(headerHtml),       // pre-built HTML fragments - insert verbatim
    CONTENT: raw(mainContent),
    FOOTER: raw(footerHtml),
    HEADER_MODE: headerMode,
    HEAD_EXTRA: raw(cssLinks),
    BODY_EXTRA: raw(jsScripts)
  };
  
  const finalHtml = normalizeWebPaths(replaceVariables(layout, pageVars));

  // Write output
  const outputFile = path.join(BUILD_DIR, `${pageData.page}.html`);
  fs.writeFileSync(outputFile, finalHtml);
  
  console.log(`[BUILD] ${pageData.page}.html - "${pageData.title}"`);
}

// Collect the CSS/JS files a page needs: global, each used component (with its
// dependencies, depth-first) plus the always-present base components, and any
// page-specific asset. `kind` is 'css' or 'js'; they differ only in the source
// filename and which base components are always included.
const ASSET_KINDS = {
  css: { sourceFile: 'style.css', base: ['header', 'footer'] },
  js: { sourceFile: 'script.js', base: ['header'] }
};

function collectComponentAssets(kind, components, pageName) {
  const { sourceFile, base } = ASSET_KINDS[kind];
  const files = [`assets/${kind}/global.${kind}`];
  const added = new Set();

  function addComponent(compName) {
    if (added.has(compName)) return;
    added.add(compName);

    // Dependencies first (depth-first), then this component's own asset - all
    // resolved site-first so site components and overrides are picked up.
    (readComponentConfig(compName).dependencies || []).forEach(addComponent);

    if (resolveComponentFile(compName, sourceFile)) {
      files.push(`assets/${kind}/${compName}.${kind}`);
    }
  }

  // Always-present base components, then the page's own components.
  base.forEach(addComponent);
  (components || []).forEach(comp => addComponent(comp.name));

  // Page-specific asset: a site page's own folder, or - for generated product
  // pages - the engine's shared product-detail asset.
  if (pageName) {
    if (pageName.startsWith('product-')) {
      if (fs.existsSync(path.join(GENERATORS_DIR, `product-detail.${kind}`))) {
        files.push(`assets/${kind}/pages/product-detail.${kind}`);
      }
    } else if (fs.existsSync(path.join(PAGES_DIR, pageName, sourceFile))) {
      files.push(`assets/${kind}/pages/${pageName}.${kind}`);
    }
  }

  return files;
}

const collectComponentCSS = (components, pageName) => collectComponentAssets('css', components, pageName);
const collectComponentJS = (components, pageName) => collectComponentAssets('js', components, pageName);

// Copy assets of one kind ('css' or 'js') into build/: the global file, every
// component's asset, each site page folder's asset, and the engine's shared
// product-detail asset used by generated product pages.
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

  // Component assets (engine + site; site overrides win, registry-relocated too)
  allComponentNames().forEach(compName => {
    const assetFile = resolveComponentFile(compName, sourceFile);
    if (assetFile) {
      fs.copyFileSync(assetFile, path.join(buildAssetDir, `${compName}.${kind}`));
    }
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

  // Engine-provided product-detail asset (shared by generated product pages).
  const productDetailAsset = path.join(GENERATORS_DIR, `product-detail.${kind}`);
  if (fs.existsSync(productDetailAsset)) {
    fs.copyFileSync(productDetailAsset, path.join(buildPagesAssetDir, `product-detail.${kind}`));
  }
}

const copyComponentCSS = () => copyComponentAssets('css');
const copyComponentJS = () => copyComponentAssets('js');

// Function to copy collections (products, custom items, etc.) based on database.json
function copyCollections() {
  if (!database.collections || database.collections.length === 0) {
    console.log('[COLLECTIONS] No collections configured in database.json');
    return;
  }
  
  const enabledCollections = database.collections.filter(c => c.enabled);
  
  if (enabledCollections.length === 0) {
    console.log('[COLLECTIONS] No enabled collections found');
    return;
  }
  
  console.log(`[COLLECTIONS] Found ${enabledCollections.length} enabled collection(s)`);
  
  enabledCollections.forEach(collection => {
    const sourcePath = path.join(SITE_ROOT, collection.source);
    const destPath = path.join(BUILD_DIR, collection.destination);

    if (fs.existsSync(sourcePath)) {
      copyDirectory(sourcePath, destPath);
      console.log(`  [FOLDER] ${collection.name}: ${collection.source} → ${collection.destination}`);
    } else {
      console.log(`  [ERROR] ${collection.name}: Source not found (${collection.source})`);
    }
  });
  
  console.log('');
}

// Main build process
console.log('========================================');
console.log('Starting website build process...');
console.log(`Time: ${new Date().toLocaleString()}`);
console.log('========================================\n');

const buildStart = Date.now();
let buildErrors = 0;  // any generator/page failure makes the build exit non-zero

// Clean build directory
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true });
}
fs.mkdirSync(BUILD_DIR, { recursive: true });

// Copy assets (excluding CSS and JS which we handle separately)
copyDirectory(path.join(ASSETS_DIR, 'images'), path.join(BUILD_DIR, 'assets', 'images'));
console.log('[ASSETS] Copied images to build/assets/');

// Copy component CSS and JS
copyComponentCSS();
console.log('[CSS] Component styles copied to build/assets/css/');

copyComponentJS();
console.log('[JS] Component scripts copied to build/assets/js/\n');

// Copy collections (products, custom items, etc.) from shared folder
copyCollections();

// Execute page generators. They run from the engine and the site (engine
// first, so a site generator can shadow a page by re-emitting it); each writes
// page JSON into GENERATED_PAGES_DIR and returns the files it wrote, which we
// build alongside the pages found under pages/.
//
// Contract (v0.2): module.exports = { generate(ctx) }. The legacy
// module.exports = { generateProductPages(outputDir) } is still supported -
// see docs/generator-migration.md.
const generatedPageFiles = [];
const generatorContext = {
  siteRoot: SITE_ROOT,
  engineRoot: ENGINE_ROOT,
  buildDir: BUILD_DIR,
  outputDir: GENERATED_PAGES_DIR,
  lib: { slugify, escapeHtml, raw }
};
const generatorRoots = [GENERATORS_DIR, path.join(SITE_ROOT, 'generators')];
const seenGeneratedFiles = new Set();

generatorRoots.forEach(genDir => {
  if (!fs.existsSync(genDir)) return;
  const scripts = fs.readdirSync(genDir).filter(f => f.endsWith('.build.js'));
  if (scripts.length === 0) return;
  console.log(`[PAGE-SCRIPTS] Running ${scripts.length} generator(s) from ${path.relative(SITE_ROOT, genDir) || '.'}`);

  scripts.forEach(scriptFile => {
    try {
      const scriptPath = path.resolve(path.join(genDir, scriptFile));
      delete require.cache[scriptPath];
      const mod = require(scriptPath);

      let generated;
      if (typeof mod.generate === 'function') {
        generated = mod.generate(generatorContext);
      } else if (typeof mod.generateProductPages === 'function') {
        generated = mod.generateProductPages(GENERATED_PAGES_DIR); // legacy contract
      } else {
        console.log(`  [WARNING] ${scriptFile}: no generate(ctx) or generateProductPages export`);
        return;
      }

      (Array.isArray(generated) ? generated : []).forEach(p => {
        const base = path.basename(p);
        if (seenGeneratedFiles.has(base)) {
          console.log(`  [WARNING] generator output collision (last wins): ${base}`);
        }
        seenGeneratedFiles.add(base);
        generatedPageFiles.push(p);
      });
    } catch (error) {
      console.error(`[ERROR] Generator ${scriptFile} failed:`, error.message);
      buildErrors++;
    }
  });
});
if (generatedPageFiles.length) console.log('');

// Build all pages
const pageFiles = [];

// Recursively find all .json files in pages directory
function findPageFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(entry => {
    // Skip underscore-prefixed files and folders: these are templates,
    // examples, and generator internals (e.g. _example, _product-detail,
    // _generators), not pages to build.
    if (entry.name.startsWith('_')) {
      return;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findPageFiles(fullPath);
    } else if (entry.name.endsWith('.json')) {
      pageFiles.push(fullPath);
    }
  });
}

findPageFiles(PAGES_DIR);

// Generated pages (from generators) are built alongside the scanned pages.
const allPageFiles = [...pageFiles, ...generatedPageFiles];

console.log(`[PAGES] Found ${pageFiles.length} page(s) + ${generatedPageFiles.length} generated page(s) to build\n`);

let pagesBuilt = 0;
allPageFiles.forEach(pageFile => {
  try {
    const pageName = path.basename(pageFile, '.json');
    buildPage(pageFile, pageName);
    pagesBuilt++;
  } catch (error) {
    console.error(`[ERROR] Failed to build ${pageFile}:`, error.message);
    buildErrors++;
  }
});

// Remove the scratch generated-pages dir so it is not shipped in build/.
if (fs.existsSync(GENERATED_PAGES_DIR)) {
  fs.rmSync(GENERATED_PAGES_DIR, { recursive: true, force: true });
}

const buildTime = ((Date.now() - buildStart) / 1000).toFixed(2);

console.log('\n========================================');
if (buildErrors > 0) {
  console.error(`Build FAILED: ${buildErrors} error(s)`);
  console.log(`Pages built: ${pagesBuilt}`);
  console.log(`Build time: ${buildTime}s`);
  console.log('========================================\n');
  // Non-zero exit so CI / scripts fail loudly instead of shipping a broken site.
  process.exitCode = 1;
} else {
  console.log('Build completed successfully');
  console.log(`Output directory: ${path.relative(SITE_ROOT, BUILD_DIR)}/`);
  console.log(`Pages built: ${pagesBuilt}`);
  console.log(`Build time: ${buildTime}s`);
  console.log('========================================\n');
}
