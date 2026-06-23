const fs = require('fs');
const path = require('path');
const { RawHtml, raw, escapeHtml } = require('./lib/html');

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

// Load a component template, resolving SITE overrides before the engine.
// A site can override any component (or the layout) by placing a same-named
// file under its own components/ dir, without forking the engine's logic.
function loadComponent(componentName) {
  // Sub-components (e.g. faqItem, productCard) live in their parent's folder.
  const subComponentMappings = {
    'faqItem': 'faq',
    'productCard': 'products',
    'header-light': 'header',
    'header-dark': 'header'
  };
  const dir = subComponentMappings[componentName] || componentName;

  // Candidate paths relative to a root: folder form first, then flat (layout).
  const candidates = [
    path.join('components', dir, `${componentName}.html`),
    path.join('components', `${componentName}.html`)
  ];

  // Site root overrides engine root.
  for (const root of [SITE_ROOT, ENGINE_ROOT]) {
    for (const rel of candidates) {
      const file = path.join(root, rel);
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, 'utf8');
      }
    }
  }

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
  
  // Check if component has a build script
  const componentDir = path.join(COMPONENTS_DIR, componentName);
  const buildScriptPath = path.join(componentDir, `${componentName}.build.js`);
  const configPath = path.join(componentDir, `${componentName}.json`);
  
  // Load component configuration if exists
  let componentConfig = { dependencies: [] };
  if (fs.existsSync(configPath)) {
    try {
      componentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.log(`  [WARNING] Failed to parse ${componentName}.json:`, error.message);
    }
  }
  
  let html = '';
  
  if (fs.existsSync(buildScriptPath)) {
    // Component has custom build logic
    const absolutePath = path.resolve(buildScriptPath);
    delete require.cache[absolutePath]; // Clear cache to allow rebuilds
    
    const buildScript = require(absolutePath);
    html = buildScript.build(vars, loadComponent, replaceVariables);
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

    const componentDir = path.join(COMPONENTS_DIR, compName);
    const configPath = path.join(componentDir, `${compName}.json`);
    const assetFile = path.join(componentDir, sourceFile);

    let componentConfig = { dependencies: [] };
    if (fs.existsSync(configPath)) {
      try {
        componentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch (error) {
        // Ignore parse errors
      }
    }

    // Add dependencies first (depth-first)
    (componentConfig.dependencies || []).forEach(addComponent);

    if (fs.existsSync(assetFile)) {
      files.push(`assets/${kind}/${compName}.${kind}`);
    }
    added.add(compName);
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

  // Component assets
  fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .forEach(dirent => {
      const assetFile = path.join(COMPONENTS_DIR, dirent.name, sourceFile);
      if (fs.existsSync(assetFile)) {
        fs.copyFileSync(assetFile, path.join(buildAssetDir, `${dirent.name}.${kind}`));
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

// Execute page build scripts (for generating dynamic pages). Generators write
// their page JSON into GENERATED_PAGES_DIR and return the list of files they
// wrote; we build those alongside the pages found under pages/.
const generatedPageFiles = [];
const generatorsDir = GENERATORS_DIR;
if (fs.existsSync(generatorsDir)) {
  const pageBuildScripts = fs.readdirSync(generatorsDir)
    .filter(f => f.endsWith('.build.js'));

  if (pageBuildScripts.length > 0) {
    console.log(`[PAGE-SCRIPTS] Found ${pageBuildScripts.length} page build script(s)\n`);

    pageBuildScripts.forEach(scriptFile => {
      try {
        const scriptPath = path.resolve(path.join(generatorsDir, scriptFile));
        delete require.cache[scriptPath];

        const pageScript = require(scriptPath);

        if (pageScript.generateProductPages && typeof pageScript.generateProductPages === 'function') {
          const generated = pageScript.generateProductPages(GENERATED_PAGES_DIR);
          if (Array.isArray(generated)) {
            generatedPageFiles.push(...generated);
          }
        }

      } catch (error) {
        console.error(`[ERROR] Page build script ${scriptFile} failed:`, error.message);
        buildErrors++;
      }
    });

    console.log('');
  }
}

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
