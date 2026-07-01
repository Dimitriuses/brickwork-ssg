// Engine smoke test: builds the bundled example/ site and asserts content-
// agnostic invariants. No test framework; exits non-zero on any failure so CI
// catches regressions. Run with `npm test`.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { standardChecks } = require('../lib/checks');
const { resolveGenerator } = require('../lib/generators');
const { globToRegExp } = require('../lib/glob');

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
// C1/C2: a nested sub-component (price_note, its own folder under pricing/) renders, and its
// own style.css is bundled + linked when the parent component is used.
check('nested sub-component renders (C1)', index.includes('class="price-note"'));
check('nested sub-component asset bundled + linked (C2)',
  fs.existsSync(path.join(buildDir, 'assets', 'css', 'price_note.css')) &&
  /assets\/css\/price_note\.css/.test(index));
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
// C3 retired the built-in detail generator: product/custom detail pages are now generator-free
// (data_model + map + carousel). The engine registry is empty, so those names no longer resolve.
check('resolver: retired built-in detail generator (products/custom -> null)',
  resolveGenerator('products', genDirs) === null && resolveGenerator('custom', genDirs) === null);
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

// C3: the product/custom detail pages are generator-free (data_model + map + carousel component),
// driven by template pages in example/pages - no detail generator involved.
check('generator-free "products" template built detail pages',
  fs.existsSync(path.join(buildDir, 'product-sample-1.html')) &&
  fs.existsSync(path.join(buildDir, 'product-sample-2.html')));
const productHtml = fs.existsSync(path.join(buildDir, 'product-sample-1.html'))
  ? fs.readFileSync(path.join(buildDir, 'product-sample-1.html'), 'utf8') : '';
// Map fills the text fields ($data.name -> title); the carousel component renders slides from the
// item's $images (per-item component vars, B2). sample-1 has 2 images -> a thumbnail strip.
check('generator-free detail: mapped title + carousel slides from $images',
  productHtml.includes('product-detail-title') && productHtml.includes('Brick A') &&
  (productHtml.match(/carousel-item/g) || []).length === 2);
check('carousel component: multi-image thumbnail strip',
  (productHtml.match(/thumbnail-image/g) || []).length === 2);
check('carousel component assets bundled + linked on the detail page',
  /assets\/css\/carousel\.css/.test(productHtml) && /assets\/js\/carousel\.js/.test(productHtml) &&
  fs.existsSync(path.join(buildDir, 'assets', 'js', 'carousel.js')));
// The built-in detail generator file is gone (retired in favour of the declarative path).
check('generate-detail.js retired (removed from engine)',
  !fs.existsSync(path.join(root, 'generators', 'generate-detail.js')));
// C3: the products grid component reads the collection via the `collection` helper (the data
// model), not raw product.json under build/ - so it stays populated under copy:false. Names come
// from item.data; links use the same slug as the generated detail pages.
const shopHtml = fs.existsSync(path.join(buildDir, 'shop.html'))
  ? fs.readFileSync(path.join(buildDir, 'shop.html'), 'utf8') : '';
check('products grid is data-model-driven (populated under copy:false)',
  shopHtml.includes('Brick A') && shopHtml.includes('Brick B') &&
  shopHtml.includes('product-sample-1.html') && !shopHtml.includes('No products available'));
// A2: the built-in path reads ctx.collection.items, so the data file (copy:false) stays out of
// build/ while images (copy:true) ship - leak control, end to end.
check('A2: collection data file not shipped (copy:false), images shipped (copy:true)',
  !fs.existsSync(path.join(buildDir, 'products', 'sample-1', 'product.json')) &&
  fs.existsSync(path.join(buildDir, 'products', 'sample-1', 'p.png')));
check('detail template integrates contactIcons (no leftover placeholder)',
  !productHtml.includes('{{COMPONENT:contactIcons}}'));
// Phase 5: page assets are generalized - the built-in detail page links its template
// folder's asset via the same assetsFrom path as any template (no product- special case).
check('detail page links its template-folder asset (generalized)',
  /assets\/css\/pages\/product-detail\.css/.test(productHtml));
// A "_"-prefixed TEMPLATE page (_custom-detail) is still discovered (the "_" is just a
// comment); it generates the custom detail pages (generator-free) over the custom collection.
check('underscore-prefixed template still discovered',
  fs.existsSync(path.join(buildDir, 'custom-item-a.html')));
// A "_"-prefixed NORMAL page (_draft) is excluded from the build.
check('underscore-prefixed normal page excluded',
  !fs.existsSync(path.join(buildDir, 'draft.html')) && !fs.existsSync(path.join(buildDir, '_draft.html')));

// Generator restructure - Phase 4: build-time validation (loud errors). Building the
// invalid-fixtures site must FAIL (non-zero exit) with a clear message per problem.
let invalidExit = 0;
let invalidOut = '';
try {
  invalidOut = execSync('node cli.js build --site test/fixtures/invalid', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  invalidExit = e.status || 1;
  invalidOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
check('invalid templates fail the build (non-zero exit)', invalidExit !== 0);
check('validation: neither generator nor source', /generatorOptions needs a `generator` or a `source`/.test(invalidOut));
check('validation: missing pageName', /generatorOptions\.pageName is required/.test(invalidOut));
check('validation: unknown generator', /unknown generator "nope-gen"/.test(invalidOut));
check('validation: source collection not found', /source collection "nope" not found/.test(invalidOut));
check('validation: source collection disabled', /source collection "off" is disabled/.test(invalidOut));
check('validation: page-name collision', /page name collision: "dup\.html"/.test(invalidOut));

// Always-on engine self-checks: `ssg test` runs the engine's checks by default,
// labeled "Engine checks", and a site can opt out via config test.engineChecks=false.
let exTestOut = '';
try {
  exTestOut = execSync('node cli.js test --site example', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  exTestOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
check('ssg test runs engine checks by default',
  /Engine checks:/.test(exTestOut) && !/Engine checks: skipped/.test(exTestOut));

let offExit = 0;
let offOut = '';
try {
  offOut = execSync('node cli.js test --site test/fixtures/checks-off', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  offExit = e.status || 1;
  offOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
check('config test.engineChecks=false skips engine checks', /Engine checks: skipped/.test(offOut));
check('disabling engine checks still exits 0 on a valid site', offExit === 0);

// Data management - leak control (Task 2 commit 1): a collection's data_model controls
// which item files reach build/. `copy` defaults true; a `copy:false` part is skipped.
check('glob: *.png matches png not jpg',
  globToRegExp('*.png').test('a.png') && !globToRegExp('*.png').test('a.jpg'));
check('glob: brace alternation, case-insensitive',
  globToRegExp('*.{jpg,png}').test('x.JPG') && globToRegExp('*.{jpg,png}').test('x.png'));
check('glob: literal filename (dot is literal)',
  globToRegExp('product.json').test('product.json') && !globToRegExp('product.json').test('product_json'));

let dmOut = '';
try {
  dmOut = execSync('node cli.js build --site test/fixtures/data-model', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  dmOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
const dmBuild = path.join(root, 'test', 'fixtures', 'data-model', 'build');
check('data_model: copy:true part reaches build',
  fs.existsSync(path.join(dmBuild, 'stuff', 'item-1', 'pic.png')));
check('data_model: undeclared file is NOT copied (copy defaults false)',
  !fs.existsSync(path.join(dmBuild, 'stuff', 'item-1', 'notes.txt')));
check('data_model: copy:false part is NOT copied (leak control)',
  !fs.existsSync(path.join(dmBuild, 'stuff', 'item-1', 'info.json')));
check('data_model: collection without a model still copies whole folder',
  fs.existsSync(path.join(dmBuild, 'legacy', 'item-1', 'a.txt')));
check('data_model: a model-less collection warns', /no data_model/.test(dmOut));

// Data management - validation (Task 2 commit 2): a malformed data_model or a missing
// `required` part fails the build with a clear message.
let dmBadExit = 0;
let dmBadOut = '';
try {
  dmBadOut = execSync('node cli.js build --site test/fixtures/data-model-bad', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  dmBadExit = e.status || 1;
  dmBadOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
check('data_model validation: invalid model fails the build', dmBadExit !== 0);
check('data_model validation: required-but-missing', /required "data" \(match data\.json\) not found/.test(dmBadOut));
check('data_model validation: bad glob (unbalanced brace)', /unbalanced \{ \} in match/.test(dmBadOut));
check('data_model validation: non-boolean copy', /"copy" must be a boolean/.test(dmBadOut));
check('map validation: bad path errors with the path',
  /map "X" -> "\$nope\.field" references unknown part "nope"/.test(dmBadOut));
check('map validation: bad component-var path errors (B2)',
  /map "Y" -> "\$alsobad\.x" references unknown part "alsobad"/.test(dmBadOut));

// Data completion - A1: the engine resolves ctx.collection.items from the data_model (`type`
// surfacing), id from folder / item.data.slug. A test generator emits one page per item.
let itemsOut = '';
try {
  itemsOut = execSync('node cli.js build --site test/fixtures/items', { cwd: root, stdio: 'pipe' }).toString();
} catch (e) {
  itemsOut = ((e.stdout || '') + '') + ((e.stderr || '') + '');
}
const itemsBuild = path.join(root, 'test', 'fixtures', 'items', 'build');
const alphaPage = fs.existsSync(path.join(itemsBuild, 'thing-the-alpha.html'))
  ? fs.readFileSync(path.join(itemsBuild, 'thing-the-alpha.html'), 'utf8') : '';
check('items: slug overridden by item.data.slug', fs.existsSync(path.join(itemsBuild, 'thing-the-alpha.html')));
check('items: slug falls back to the folder name', fs.existsSync(path.join(itemsBuild, 'thing-beta.html')));
check('items: object part parsed (data.name surfaced)', /Alpha/.test(alphaPage));
check('items: paths part -> web paths + count',
  /things\/alpha\/1\.png/.test(alphaPage) && /thing-count">2/.test(alphaPage));
check('items: copy:false data stays out of build, images ship',
  !fs.existsSync(path.join(itemsBuild, 'things', 'alpha', 'info.json')) &&
  fs.existsSync(path.join(itemsBuild, 'things', 'alpha', '1.png')));
check('items: omitted `required` warns (grouped at end)',
  /part "images": no `required`/.test(itemsOut));
// B1: a generator-free template renders one page per item via `map` ($-paths into item);
// a map miss resolves to "" and warns.
const mappedAlpha = fs.existsSync(path.join(itemsBuild, 'mapped-the-alpha.html'))
  ? fs.readFileSync(path.join(itemsBuild, 'mapped-the-alpha.html'), 'utf8') : '';
check('map: generator-free template fills placeholders ($data.name)',
  fs.existsSync(path.join(itemsBuild, 'mapped-the-alpha.html')) && /Alpha/.test(mappedAlpha));
check('map: a miss resolves to "" and warns',
  /\[\]/.test(mappedAlpha) && /map path "\$data\.nope" resolved to nothing/.test(itemsOut));
// B2: a template page's component vars resolve $-paths against the item (scalar $data.name and
// array $images both reach the badge component).
check('component vars resolve per item (B2)', /class="badge">Alpha \(2\)/.test(mappedAlpha));

// --- lib/colors.js (terminal UX) ---
const colors = require('../lib/colors');
check('colors: disabled palette is identity (byte-identical output when off)',
  colors.palette(false).green('x') === 'x' && colors.palette(false).red('y') === 'y');
check('colors: enabled palette wraps in ANSI + reset',
  colors.palette(true).green('x') === '\x1b[32mx\x1b[0m');
check('colors: policy never/always override detection',
  colors.shouldColor('never', { isTTY: true }) === false &&
  colors.shouldColor('always', { isTTY: false }) === true);
// The 'auto' branch reads env, so control it for a deterministic assertion.
(() => {
  const nc = process.env.NO_COLOR, fc = process.env.FORCE_COLOR;
  delete process.env.NO_COLOR; delete process.env.FORCE_COLOR;
  check('colors: auto follows TTY',
    colors.shouldColor('auto', { isTTY: true }) === true &&
    colors.shouldColor('auto', { isTTY: false }) === false);
  process.env.NO_COLOR = '1';
  check('colors: NO_COLOR disables auto even on a TTY',
    colors.shouldColor('auto', { isTTY: true }) === false);
  delete process.env.NO_COLOR;
  if (nc !== undefined) process.env.NO_COLOR = nc;
  if (fc !== undefined) process.env.FORCE_COLOR = fc;
})();

// --- lib/log.js (terminal UX) ---
const { createLogger } = require('../lib/log');
// Capture what a function writes to stdout/stderr (restored afterwards).
function captureStreams(fn) {
  const out = [], err = [];
  const so = process.stdout.write.bind(process.stdout);
  const se = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { out.push(s); return true; };
  process.stderr.write = (s) => { err.push(s); return true; };
  try { fn(); } finally { process.stdout.write = so; process.stderr.write = se; }
  return { out: out.join(''), err: err.join('') };
}

// Record shape: structured entry with UTC timestamp, level, provenance, open metadata.
const lgRec = createLogger().begin({ capture: true });
lgRec.warn('w', { phase: 'collections', logger: 'component', source: 'c.build.js', hint: 'fix it' });
const rec = lgRec.records()[0];
check('log: record has schema (timestamp/phase/level/logger/message/metadata)',
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rec.timestamp) &&
  rec.level === 'WARNING' && rec.phase === 'collections' && rec.logger === 'component' &&
  rec.message === 'w' && rec.metadata.source === 'c.build.js' && rec.metadata.hint === 'fix it');

// Summary (success), warnings deduped, colour off -> byte-identical text.
const lgOk = createLogger().begin({ color: 'never', mode: 'normal' });
const okCap = captureStreams(() => {
  lgOk.warn('be careful');
  lgOk.warn('be careful');            // deduped -> (x2)
  lgOk.success('all good');
  lgOk.summary({ pagesBuilt: 3, errors: 0, elapsedMs: 120, outputDir: 'build/' });
});
check('log: warnings dedupe with (xN) in the flushed block',
  okCap.out.includes('  - be careful (x2)'));
check('log: success streams at normal + green-off is plain', okCap.out.includes('all good'));
check('log: success summary text (plain when colour off)',
  okCap.out.includes('Build completed successfully') && okCap.out.includes('Output directory: build/') &&
  okCap.out.includes('Pages built: 3') && okCap.out.includes('Build time: 0.12s'));

// Summary (failure) -> verdict on stderr, non-zero-ish; errorCount tallied.
const lgErr = createLogger().begin({ color: 'never' });
const errCap = captureStreams(() => {
  lgErr.error('boom');
  lgErr.summary({ pagesBuilt: 1, errors: 1, elapsedMs: 50 });
});
check('log: errors stream live to stderr + FAILED verdict on stderr',
  errCap.err.includes('[ERROR] boom') && errCap.err.includes('Build FAILED: 1 error(s)'));
check('log: errorCount tallied', lgErr.errorCount === 1);

// Level mapping: info is verbose-only; success is hidden at quiet.
const infoNormal = captureStreams(() => createLogger().begin({ color: 'never', mode: 'normal' }).info('detail'));
const infoVerbose = captureStreams(() => createLogger().begin({ color: 'never', mode: 'verbose' }).info('detail'));
const okQuiet = captureStreams(() => createLogger().begin({ color: 'never', mode: 'quiet' }).success('hi'));
check('log: level mapping (info verbose-only, success hidden at quiet)',
  infoNormal.out === '' && infoVerbose.out.includes('detail') && okQuiet.out === '');

done();
