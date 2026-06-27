// Engine smoke test: builds the bundled example/ site and asserts content-
// agnostic invariants. No test framework; exits non-zero on any failure so CI
// catches regressions. Run with `npm test`.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { standardChecks } = require('../lib/checks');
const { resolveGenerator } = require('../lib/generators');

const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'example');
const buildDir = path.join(siteDir, 'build');

let passes = 0;
let failures = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.error(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
}
function done() {
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

console.log('Smoke test: building example/ site...');
let buildOk = true;
let buildOut = '';
try {
  buildOut = execSync('node cli.js build --site example', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  buildOk = false;
  buildOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
  process.stderr.write(buildOut);
}
check('build exits 0', buildOk);

if (!fs.existsSync(buildDir)) {
  check('example/build/ exists', false);
  done();
}

// Reusable, content-agnostic invariants (shared with `ssg test` via lib/checks.js).
for (const r of standardChecks(buildDir)) check(r.name, r.ok, r.detail);

const index = fs.existsSync(path.join(buildDir, 'index.html'))
  ? fs.readFileSync(path.join(buildDir, 'index.html'), 'utf8') : '';
check('index.html exists', fs.existsSync(path.join(buildDir, 'index.html')));
check('layout: <header> present', index.includes('<header'));
check('layout: <footer> present', index.includes('<footer'));

// Phase A: a site-authored component (example/components/pricing) renders with
// its own template + build logic + CSS, resolved site-first by the engine.
check('site component renders (pricing template)', index.includes('<section class="pricing">'));
check('site component build logic ran (PLANS expanded)', index.includes('Basic') && index.includes('Pro'));
check('site component CSS copied', fs.existsSync(path.join(buildDir, 'assets', 'css', 'pricing.css')));
check('site component CSS linked', /assets\/css\/pricing\.css/.test(index));
// Phase B: the site component declares its own sub-component (priceRow) in
// pricing.json, resolved via the dynamic sub-component map.
check('site sub-component renders (declared priceRow)', index.includes('class="price-row"'));
// (The Phase C news generator and the v0.2.1 *.build.js auto-run / shadow fixtures
// were removed in restructure Phase 3 - the legacy dispatch no longer exists; the
// catalog/product-detail template pages below cover site + built-in generation.)

// Generator restructure - Phase 1: resolveGenerator(name) maps a registry name to a
// file, merging the engine + site generators/registry.json (site wins) then resolving
// the file site-first.
const genDirs = {
  engineGeneratorsDir: path.join(root, 'generators'),
  siteGeneratorsDir: path.join(siteDir, 'generators')
};
check('resolver: engine-registered name -> engine file',
  resolveGenerator('products', genDirs) === path.join(root, 'generators', 'generate-detail.js'));
check('resolver: built-ins share one generator (custom -> same file)',
  resolveGenerator('custom', genDirs) === path.join(root, 'generators', 'generate-detail.js'));
check('resolver: site registry name -> site file',
  resolveGenerator('collection', genDirs) === path.join(siteDir, 'generators', 'generate-collection.js'));
check('resolver: unknown name -> null', resolveGenerator('does-not-exist', genDirs) === null);

// Generator restructure - Phase 2: a TEMPLATE page (carrying generatorOptions) is
// expanded by its named generator into one page per item via generate(ctx, options).
// example/pages/catalog drives the "collection" generator over the products collection.
const catalog1 = path.join(buildDir, 'catalog-sample-1.html');
check('template page expanded (one page per item)',
  fs.existsSync(catalog1) && fs.existsSync(path.join(buildDir, 'catalog-sample-2.html')));
const catalogHtml = fs.existsSync(catalog1) ? fs.readFileSync(catalog1, 'utf8') : '';
check('template: generator vars filled (image via collection webPath)',
  catalogHtml.includes('products/sample-1/p.png'));
check('template: declared components integrated (pricing)', catalogHtml.includes('class="pricing"'));
check('template: template-page asset linked', /assets\/css\/pages\/catalog\.css/.test(catalogHtml));
const catalogCss = path.join(buildDir, 'assets', 'css', 'pages', 'catalog.css');
check('template: template-page asset copied with marker',
  fs.existsSync(catalogCss) && fs.readFileSync(catalogCss, 'utf8').includes('catalog-marker'));
check('template page itself not built literally', !fs.existsSync(path.join(buildDir, 'catalog.html')));

// Generator restructure - Phase 3: the legacy dispatch is gone; the built-in product/
// custom generators are data-only (one generate-detail.js, registered as products+custom)
// and driven by template pages in example/pages.
check('built-in "products" template built detail pages',
  fs.existsSync(path.join(buildDir, 'product-sample-1.html')) &&
  fs.existsSync(path.join(buildDir, 'product-sample-2.html')));
const productHtml = fs.existsSync(path.join(buildDir, 'product-sample-1.html'))
  ? fs.readFileSync(path.join(buildDir, 'product-sample-1.html'), 'utf8') : '';
check('built-in generator filled the detail template (carousel + title)',
  productHtml.includes('carousel-item') && productHtml.includes('product-detail-title'));
check('detail template integrates contactIcons (no leftover placeholder)',
  !productHtml.includes('{{COMPONENT:contactIcons}}'));
// A "_"-prefixed TEMPLATE page (_custom-detail) is still discovered (the "_" is just a
// comment); it drives the "custom" built-in over the custom collection.
check('underscore-prefixed template still discovered',
  fs.existsSync(path.join(buildDir, 'custom-item-a.html')));
// A "_"-prefixed NORMAL page (_draft) is excluded from the build.
check('underscore-prefixed normal page excluded',
  !fs.existsSync(path.join(buildDir, 'draft.html')) && !fs.existsSync(path.join(buildDir, '_draft.html')));

done();
