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
// Slim core: the example owns only its authored materials (blocks/pricing); it self-deploys the
// catalog materials it uses before building — the "self-deploying showcase" that keeps the catalog
// exercised every run. Deployed folders are gitignored, not committed.
let deployOk = true;
try {
  execSync('node cli.js add material --all-used --site example', { cwd: root, stdio: 'pipe' });
} catch (e) {
  deployOk = false;
  process.stderr.write(((e.stdout || '') + '') + ((e.stderr || '') + ''));
}
check('example self-deploys its catalog materials', deployOk);

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
// Header/footer render via {{COMPONENT:header/footer}} (declared _layout dependencies); the per-page
// header_theme reaches the header component as HEADER_MODE -> data-navbar-style.
check('layout: header component receives the theme (HEADER_MODE via {{COMPONENT:header}})',
  /<header[^>]*data-navbar-style="(light|dark)"/.test(index));

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

// Level mapping: info (narration) shows at normal; debug (per-item) is verbose-only; success is
// hidden at quiet.
const infoNormal = captureStreams(() => createLogger().begin({ color: 'never', mode: 'normal' }).info('narrate'));
const debugNormal = captureStreams(() => createLogger().begin({ color: 'never', mode: 'normal' }).debug('detail'));
const debugVerbose = captureStreams(() => createLogger().begin({ color: 'never', mode: 'verbose' }).debug('detail'));
const okQuiet = captureStreams(() => createLogger().begin({ color: 'never', mode: 'quiet' }).success('hi'));
check('log: level mapping (info at normal, debug verbose-only, success hidden at quiet)',
  infoNormal.out.includes('narrate') && debugNormal.out === '' &&
  debugVerbose.out.includes('detail') && okQuiet.out === '');
// ssg test shares this palette so its ok/FAIL colour matches the build + honours --no-color.
check('log: palette exposed for shared colouring',
  typeof require('../lib/log').palette.green === 'function');
// Scoped logger (build-script helpers): pre-binds provenance, per-call meta overrides.
const scopedLg = createLogger().begin({ capture: true });
scopedLg.scoped({ logger: 'component', source: 'x.build.js', phase: 'components' }).warn('scoped msg', { hint: 'h' });
const sr = scopedLg.records()[0];
check('log: scoped() pre-binds provenance (logger/source/phase) + merges meta',
  sr.logger === 'component' && sr.metadata.source === 'x.build.js' && sr.phase === 'components' &&
  sr.level === 'WARNING' && sr.metadata.hint === 'h');

// --- lib/log-config.js: layered resolution (defaults -> config -> config[command] -> CLI) ---
const { resolveLogOptions } = require('../lib/log-config');
check('log-config: defaults (normal/auto)', (() => {
  const o = resolveLogOptions({}, 'build', []); return o.mode === 'normal' && o.color === 'auto';
})());
check('log-config: config.json log block applies', (() => {
  const o = resolveLogOptions({ log: { level: 'verbose', color: 'never' } }, 'build', []);
  return o.mode === 'verbose' && o.color === 'never';
})());
check('log-config: per-command override beats shared', (() => {
  const o = resolveLogOptions({ log: { level: 'normal', build: { level: 'quiet' } } }, 'build', []);
  return o.mode === 'quiet';
})());
check('log-config: CLI wins, --log key=value (comma-joined)', (() => {
  const o = resolveLogOptions({ log: { level: 'quiet' } }, 'build', ['build', '--log', 'level=verbose,color=never']);
  return o.mode === 'verbose' && o.color === 'never';
})());
check('log-config: --quiet/--verbose/--no-color aliases', (() => {
  return resolveLogOptions({}, 'build', ['--quiet']).mode === 'quiet' &&
    resolveLogOptions({}, 'build', ['--verbose']).mode === 'verbose' &&
    resolveLogOptions({}, 'build', ['--no-color']).color === 'never';
})());

// Integration: flags actually change what the CLI prints (colour off in a pipe).
const verboseOut = execSync('node cli.js build --site example --verbose', { cwd: root, stdio: 'pipe' }).toString();
check('flags: --verbose shows per-item [BUILD] lines', /\[BUILD\] /.test(verboseOut));
const quietOut = execSync('node cli.js build --site example --quiet', { cwd: root, stdio: 'pipe' }).toString();
check('flags: --quiet is silent except the summary (build.js + component scripts)',
  !/\[COLLECTIONS\]/.test(quietOut) && !/\[PRODUCTS\]/.test(quietOut) && /Build completed successfully/.test(quietOut));

// --- file sink + retention (log commit 8) ---
check('log-config: file from config (object) + CLI format=jsonl', (() => {
  const o = resolveLogOptions({ log: { file: { dir: 'log' } } }, 'build', ['--log', 'file=true,format=jsonl']);
  return o.file && o.file.dir === 'log' && o.file.format === 'jsonl';
})());
check('log-config: --log file=false disables the sink', (() => {
  return resolveLogOptions({ log: { file: true } }, 'build', ['--log', 'file=false']).file === false;
})());

const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwlog-'));
try {
  // text sink: capture mode -> file only, no console noise.
  const lgf = createLogger();
  lgf.configure({ color: 'never', capture: true, file: { dir: path.join(tmp, 'log'), format: 'text' } });
  lgf.info('hello narrate', { phase: 'x' });
  lgf.warn('careful', { phase: 'x', hint: 'do y' });
  lgf.error('boom', { phase: 'x' });
  const textContent = fs.readFileSync(lgf.filePath, 'utf8');
  check('file sink: per-run <stamp>-<pid>.log, records appended (text)',
    /^\d{8}T\d{9}Z-\d+\.log$/.test(path.basename(lgf.filePath)) &&
    /INFO\s+hello narrate/.test(textContent) && /WARNING\s+careful/.test(textContent) &&
    /ERROR\s+boom/.test(textContent));

  // jsonl sink: one JSON record per line (streaming-durable).
  const lgj = createLogger();
  lgj.configure({ capture: true, file: { dir: path.join(tmp, 'jlog'), format: 'jsonl' } });
  lgj.warn('w', { phase: 'p', hint: 'h' });
  const firstLine = JSON.parse(fs.readFileSync(lgj.filePath, 'utf8').trim().split('\n')[0]);
  check('file sink: jsonl one record per line',
    /\.jsonl$/.test(lgj.filePath) && firstLine.level === 'WARNING' &&
    firstLine.phase === 'p' && firstLine.metadata.hint === 'h');

  // retention: keep newest N own-pattern files, delete older; never touch foreign files.
  const rdir = path.join(tmp, 'ret');
  fs.mkdirSync(rdir, { recursive: true });
  ['20260101T000000000Z-1.log', '20260102T000000000Z-1.log', '20260103T000000000Z-1.log',
    '20260104T000000000Z-1.log', '20260105T000000000Z-1.log'].forEach(f => fs.writeFileSync(path.join(rdir, f), 'x'));
  fs.writeFileSync(path.join(rdir, 'keepme.txt'), 'x');
  createLogger().configure({ capture: true, file: { dir: rdir, retention: { maxFiles: 2 } } });
  const after = fs.readdirSync(rdir);
  check('file sink: retention maxFiles prunes oldest own-pattern, keeps foreign',
    after.includes('20260104T000000000Z-1.log') && after.includes('20260105T000000000Z-1.log') &&
    !after.includes('20260101T000000000Z-1.log') && after.includes('keepme.txt'));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// --- lib/deploy.js: the material copy primitive (slim-core Phase 1, commit 1) ---
const { deployMaterial } = require('../lib/deploy');
const engineComponentsDir = path.join(root, 'catalog'); // deployable materials live in the catalog now
const dtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwdeploy-'));
try {
  const siteComponentsDir = path.join(dtmp, 'components');
  const carouselHtml = () => fs.readFileSync(path.join(siteComponentsDir, 'carousel', 'carousel.html'), 'utf8');

  // Fresh deploy copies every engine file (incl. script.js), reports no drift, writes them.
  const r1 = deployMaterial('carousel', { engineComponentsDir, siteComponentsDir });
  check('deploy: fresh copy pulls all engine files',
    r1.exists && r1.copied.includes('carousel.html') && r1.copied.includes('script.js') &&
    r1.drifted.length === 0 && fs.existsSync(path.join(siteComponentsDir, 'carousel', 'carousel.build.js')));

  // Re-run is idempotent: identical files are skipped, nothing copied.
  const r2 = deployMaterial('carousel', { engineComponentsDir, siteComponentsDir });
  check('deploy: identical files skipped (idempotent)',
    r2.copied.length === 0 && r2.drifted.length === 0 && r2.skipped.includes('carousel.html'));

  // An edited owned file is reported as drift and NOT overwritten.
  fs.writeFileSync(path.join(siteComponentsDir, 'carousel', 'carousel.html'), 'EDITED');
  const r3 = deployMaterial('carousel', { engineComponentsDir, siteComponentsDir });
  check('deploy: drift detected + reported, not overwritten',
    r3.drifted.includes('carousel.html') && carouselHtml() === 'EDITED');

  // --force overwrites the drifted file.
  const r4 = deployMaterial('carousel', { engineComponentsDir, siteComponentsDir, force: true });
  check('deploy: --force overwrites drift', r4.drifted.includes('carousel.html') && carouselHtml() !== 'EDITED');

  // --dry-run into a clean site reports the copies but writes nothing.
  const dryDir = path.join(dtmp, 'dry', 'components');
  const r5 = deployMaterial('carousel', { engineComponentsDir, siteComponentsDir: dryDir, dryRun: true });
  check('deploy: --dry-run reports without writing',
    r5.copied.includes('carousel.html') && !fs.existsSync(path.join(dryDir, 'carousel', 'carousel.html')));

  // Unknown material -> exists:false, nothing copied.
  const r6 = deployMaterial('does-not-exist', { engineComponentsDir, siteComponentsDir });
  check('deploy: unknown material -> exists:false', r6.exists === false && r6.copied.length === 0);
} finally {
  try { fs.rmSync(dtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// ssg add material — CLI integration (colour off in a pipe).
const atmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwadd-'));
const atmpArg = atmp.replace(/\\/g, '/');
try {
  const out = execSync(`node cli.js add material carousel --site "${atmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  check('ssg add material: deploys the material + summary',
    /added 4 file\(s\) for "carousel"/.test(out) &&
    fs.existsSync(path.join(atmp, 'components', 'carousel', 'carousel.html')));
  let addExit = 0, addErr = '';
  try { execSync(`node cli.js add material nope-material --site "${atmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { addExit = e.status || 1; addErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg add material: unknown material errors (non-zero exit)',
    addExit !== 0 && /no material "nope-material"/.test(addErr));
  // Unknown/missing kind is a usage error.
  let kindExit = 0, kindErr = '';
  try { execSync(`node cli.js add bogus foo --site "${atmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { kindExit = e.status || 1; kindErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg add: unknown kind errors with usage',
    kindExit !== 0 && /unknown kind "bogus"/.test(kindErr));
} finally {
  try { fs.rmSync(atmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// ssg add <kind> — scaffolders (lib/scaffold.js): page / component / generator / builder.
const stmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwscaf-'));
const stmpArg = stmp.replace(/\\/g, '/');
try {
  // page: stubs incl. the .json schema; --layout overrides the default _layout.
  const pout = execSync(`node cli.js add page about --layout=marketing --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  const pjson = JSON.parse(fs.readFileSync(path.join(stmp, 'pages', 'about', 'about.json'), 'utf8'));
  check('scaffold page: html/json/style/script + --layout applied',
    /created 4 file\(s\) for page "about"/.test(pout) &&
    fs.existsSync(path.join(stmp, 'pages', 'about', 'about.html')) &&
    fs.existsSync(path.join(stmp, 'pages', 'about', 'style.css')) &&
    fs.existsSync(path.join(stmp, 'pages', 'about', 'script.js')) &&
    pjson.page === 'about' && pjson.layout === 'marketing' && Array.isArray(pjson.components));

  // never clobber without --force; --force overwrites.
  fs.writeFileSync(path.join(stmp, 'pages', 'about', 'about.html'), 'MINE');
  execSync(`node cli.js add page about --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  const kept = fs.readFileSync(path.join(stmp, 'pages', 'about', 'about.html'), 'utf8');
  execSync(`node cli.js add page about --force --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  const forced = fs.readFileSync(path.join(stmp, 'pages', 'about', 'about.html'), 'utf8');
  check('scaffold: refuses to clobber; --force overwrites', kept === 'MINE' && forced !== 'MINE');

  // component: --folder places files, --register writes the registry remap.
  execSync(`node cli.js add component fancyBox --folder=widgets --register --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  const creg = JSON.parse(fs.readFileSync(path.join(stmp, 'components', 'registry.json'), 'utf8'));
  check('scaffold component: --folder places + --register remaps',
    fs.existsSync(path.join(stmp, 'components', 'widgets', 'fancyBox.html')) &&
    fs.existsSync(path.join(stmp, 'components', 'widgets', 'style.css')) && creg.fancyBox === 'widgets');

  // generator: file + registry entry (generators resolve by registry name).
  execSync(`node cli.js add generator news --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  const greg = JSON.parse(fs.readFileSync(path.join(stmp, 'generators', 'registry.json'), 'utf8'));
  check('scaffold generator: file + registry entry',
    fs.existsSync(path.join(stmp, 'generators', 'generate-news.js')) && greg.news === 'generate-news.js');

  // builder: attaches <name>.build.js to an existing component; errors if the component is missing.
  execSync(`node cli.js add builder fancyBox --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  check('scaffold builder: attaches build.js to the existing component (registry folder)',
    fs.existsSync(path.join(stmp, 'components', 'widgets', 'fancyBox.build.js')));
  let bExit = 0, bErr = '';
  try { execSync(`node cli.js add builder ghost --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { bExit = e.status || 1; bErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('scaffold builder: errors when the component does not exist',
    bExit !== 0 && /no component "ghost"/.test(bErr));

  // test: a runnable test/<name>.test.js stub (folder-discovered, no registry).
  execSync(`node cli.js add test smoke --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' });
  const testStub = fs.readFileSync(path.join(stmp, 'test', 'smoke.test.js'), 'utf8');
  check('scaffold test: writes test/<name>.test.js exporting a test function',
    fs.existsSync(path.join(stmp, 'test', 'smoke.test.js')) &&
    /module\.exports\s*=\s*\(ctx\)\s*=>/.test(testStub) && /ctx\.check\(/.test(testStub));

  // --dry-run writes nothing.
  const dout = execSync(`node cli.js add page ghostpage --dry-run --site "${stmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  check('scaffold: --dry-run reports without writing',
    /would create 4 file\(s\) for page "ghostpage"/.test(dout) &&
    !fs.existsSync(path.join(stmp, 'pages', 'ghostpage')));
} finally {
  try { fs.rmSync(stmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// --- lib/components.js (shared resolver) + lib/used-materials.js (used-set walk) ---
const { createComponents } = require('../lib/components');
const C = createComponents({ siteRoot: siteDir, engineRoot: root });
check('components: shared resolver — folder map + site-first resolution',
  C.componentFolder('faqItem') === 'faq' && C.componentFolder('header') === 'header' &&
  !!C.resolveComponentFile('header', 'header.html'));

const { usedComponentNames } = require('../lib/used-materials');
const uc = usedComponentNames({ siteRoot: siteDir, engineRoot: root });
check('used-materials: finds referenced + always-on components',
  ['header', 'footer', '_layout', 'products', 'carousel', 'faq', 'hero'].every(n => uc.used.includes(n)));
check('used-materials: sub-components collapse to their parent folder (deploy folders)',
  uc.used.includes('productCard') && uc.used.includes('faqItem') &&
  uc.folders.includes('products') && uc.folders.includes('faq') &&
  !uc.folders.includes('productCard') && !uc.folders.includes('faqItem'));

// Acceptance: `ssg add material --all-used` on an inheriting site -> it owns every used material
// folder (the completeness the slim core relies on). Sub-components + dependencies come along.
const utmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwall-'));
const utmpArg = utmp.replace(/\\/g, '/');
try {
  fs.mkdirSync(path.join(utmp, 'pages', 'index'), { recursive: true });
  fs.writeFileSync(path.join(utmp, 'pages', 'index', 'index.json'),
    JSON.stringify({ page: 'index', layout: '_layout', components: [{ name: 'hero', vars: {} }, { name: 'faq', vars: {} }] }));
  fs.writeFileSync(path.join(utmp, 'config.json'), JSON.stringify({ site: { name: 'T' }, nav: [] }));
  const out = execSync(`node cli.js add material --all-used --site "${utmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  const folders = usedComponentNames({ siteRoot: utmp, engineRoot: root }).folders;
  const ownsAll = folders.every(f => fs.existsSync(path.join(utmp, 'components', f)));
  check('ssg add material --all-used: inheriting site ends up owning every used material folder',
    /across \d+ material\(s\)/.test(out) && ownsAll &&
    fs.existsSync(path.join(utmp, 'components', 'faq', 'faqItem.html')) &&   // sub-component came along
    fs.existsSync(path.join(utmp, 'components', 'contactIcons')));          // footer dependency pulled in
} finally {
  try { fs.rmSync(utmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// _layout is now a first-class component (goes through buildComponent): a site _layout with a
// _layout.build.js has its build script honoured — impossible when the layout was loaded specially.
const ltmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwlayout-'));
const ltmpArg = ltmp.replace(/\\/g, '/');
try {
  fs.mkdirSync(path.join(ltmp, 'pages', 'index'), { recursive: true });
  fs.mkdirSync(path.join(ltmp, 'components', '_layout'), { recursive: true });
  fs.mkdirSync(path.join(ltmp, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(ltmp, 'config.json'), JSON.stringify({ site: { name: 'L' }, nav: [] }));
  fs.writeFileSync(path.join(ltmp, 'pages', 'index', 'index.json'),
    JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  fs.writeFileSync(path.join(ltmp, 'pages', 'index', 'index.html'), '<main>hi</main>');
  fs.writeFileSync(path.join(ltmp, 'components', '_layout', '_layout.html'),
    '<!doctype html><html><head><title>{{PAGE_TITLE}}</title></head><body>{{CONTENT}}</body></html>');
  fs.writeFileSync(path.join(ltmp, 'components', '_layout', '_layout.build.js'),
    "module.exports = { build(vars, loadComponent, replaceVariables) { return '<!--LAYOUT-BUILD-RAN-->' + replaceVariables(loadComponent('_layout'), vars); } };");
  let outHtml = '';
  try {
    execSync(`node cli.js build --site "${ltmpArg}"`, { cwd: root, stdio: 'pipe' });
    outHtml = fs.readFileSync(path.join(ltmp, 'build', 'index.html'), 'utf8');
  } catch (e) { outHtml = ''; }
  check('_layout runs through buildComponent (a layout build.js is honoured)',
    outHtml.includes('<!--LAYOUT-BUILD-RAN-->') && outHtml.includes('<main>hi</main>'));
} finally {
  try { fs.rmSync(ltmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Slim core: a build that references a material the site doesn't own fails loudly with an
// actionable "not installed — run ssg add material <name>" message (not a silent broken page).
const ntmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwnotinst-'));
const ntmpArg = ntmp.replace(/\\/g, '/');
try {
  fs.mkdirSync(path.join(ntmp, 'pages', 'index'), { recursive: true });
  fs.mkdirSync(path.join(ntmp, 'components', '_layout'), { recursive: true });
  fs.mkdirSync(path.join(ntmp, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(ntmp, 'config.json'), JSON.stringify({ site: { name: 'N' }, nav: [] }));
  fs.writeFileSync(path.join(ntmp, 'pages', 'index', 'index.json'),
    JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  fs.writeFileSync(path.join(ntmp, 'pages', 'index', 'index.html'), '<main>hi</main>');
  // Owns _layout, but the layout references a material (hero) the site does not own.
  fs.writeFileSync(path.join(ntmp, 'components', '_layout', '_layout.html'),
    '<!doctype html><html><head><title>{{PAGE_TITLE}}</title></head><body>{{COMPONENT:hero}}{{CONTENT}}</body></html>');
  let niExit = 0, niErr = '';
  try { execSync(`node cli.js build --site "${ntmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { niExit = e.status || 1; niErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('slim core: an unowned material fails the build with an actionable message',
    niExit !== 0 && /not installed/.test(niErr) && /ssg add material hero/.test(niErr));
} finally {
  try { fs.rmSync(ntmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// ssg init: a blank project builds out of the box — into a subdir (like `ssg init ./src`), with no
// assets/images/ present (guards the ENOENT-on-missing-images fix).
const itmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwinit-'));
const itmpArg = itmp.replace(/\\/g, '/');
try {
  const iout = execSync(`node cli.js init "${itmpArg}/src"`, { cwd: root, stdio: 'pipe' }).toString();
  const initRoot = path.join(itmp, 'src');
  const has = (f) => fs.existsSync(path.join(initRoot, f));
  check('ssg init: scaffolds a blank site into a subdir',
    /created 7 file\(s\)/.test(iout) && has('config.json') && has('package.json') &&
    has('components/_layout/_layout.html') && has('pages/index/index.json') &&
    has('assets/css/global.css') && has('assets/js/global.js'));
  execSync(`node cli.js build --site "${itmpArg}/src"`, { cwd: root, stdio: 'pipe' });
  const home = fs.readFileSync(path.join(initRoot, 'build', 'index.html'), 'utf8');
  check('ssg init: the blank site builds a page (welcome + global.css, no assets/images needed)',
    /Welcome to brickwork/.test(home) && /assets\/css\/global\.css/.test(home));
  // --template wiring: an unknown template errors (offline-safe; the real `--template demo` clone is a
  // network + CI-gated path, verified out of band — not run in smoke).
  let tmplExit = 0, tmplErr = '';
  try { execSync(`node cli.js init "${itmpArg}/x" --template bogus`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { tmplExit = e.status || 1; tmplErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg init --template: unknown template errors', tmplExit !== 0 && /unknown template "bogus"/.test(tmplErr));
} finally {
  try { fs.rmSync(itmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Regression (v0.6.0): a {{COMPONENT:x}} inside an HTML comment in page CONTENT must NOT be expanded by
// the layout's buildComponent pass — a commented-out component stays disabled — while a live inline one
// and the layout's own {{COMPONENT}} still render.
const rtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwreg-'));
const rtmpArg = rtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(rtmp, p)), { recursive: true }); fs.writeFileSync(path.join(rtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'R' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{HEAD_EXTRA}}</head><body>{{COMPONENT:header}}{{CONTENT}}{{BODY_EXTRA}}</body></html>');
  mk('components/header/header.html', '<header>SITE-HEADER</header>');
  mk('components/badge/badge.html', '<div>BADGE-OK</div>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>{{COMPONENT:badge}} <!-- {{COMPONENT:badge}} --></main>');
  fs.mkdirSync(path.join(rtmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${rtmpArg}"`, { cwd: root, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(rtmp, 'build', 'index.html'), 'utf8');
  check('commented {{COMPONENT}} in content stays disabled; live + layout ones render',
    (out.match(/BADGE-OK/g) || []).length === 1 && out.includes('{{COMPONENT:badge}}') && out.includes('SITE-HEADER'));
} finally {
  try { fs.rmSync(rtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// ssg build surfaces unresolved {{VAR}} as a warning (was silent; ssg test still fails on them). A
// commented-out placeholder is ignored (comment-stripped, like lib/checks.js).
const vtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwvar-'));
const vtmpArg = vtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(vtmp, p)), { recursive: true }); fs.writeFileSync(path.join(vtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'V' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{HEAD_EXTRA}}</head><body>{{CONTENT}}{{BODY_EXTRA}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>Hi {{UNFILLED_THING}} <!-- {{COMMENTED_VAR}} --></main>');
  fs.mkdirSync(path.join(vtmp, 'assets', 'images'), { recursive: true });
  let vExit = 0, vOut = '';
  try { vOut = execSync(`node cli.js build --site "${vtmpArg}"`, { cwd: root, stdio: 'pipe' }).toString(); }
  catch (e) { vExit = e.status || 1; vOut = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg build warns on unresolved {{VAR}} (non-fatal; commented ignored)',
    vExit === 0 && /Unresolved placeholder/.test(vOut) && /UNFILLED_THING/.test(vOut) && !/COMMENTED_VAR/.test(vOut));
} finally {
  try { fs.rmSync(vtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// {{CSS_LINKS}}/{{JS_SCRIPTS}} are the self-describing names for the collected CSS/JS tags;
// {{HEAD_EXTRA}}/{{BODY_EXTRA}} remain as deprecated aliases (same value) so existing layouts work.
const btmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwalias-'));
const btmpArg = btmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(btmp, p)), { recursive: true }); fs.writeFileSync(path.join(btmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'A' }, nav: [] }));
  mk('assets/css/global.css', '/* g */');
  mk('assets/js/global.js', '// g');
  mk('components/_layout/_layout.html', '<!doctype html><html><head>NEW:{{CSS_LINKS}} OLD:{{HEAD_EXTRA}}</head><body>{{CONTENT}} NEW:{{JS_SCRIPTS}} OLD:{{BODY_EXTRA}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>x</main>');
  fs.mkdirSync(path.join(btmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${btmpArg}"`, { cwd: root, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(btmp, 'build', 'index.html'), 'utf8');
  check('{{CSS_LINKS}}/{{JS_SCRIPTS}} + deprecated {{HEAD_EXTRA}}/{{BODY_EXTRA}} aliases both fill',
    (out.match(/assets\/css\/global\.css/g) || []).length === 2 && (out.match(/assets\/js\/global\.js/g) || []).length === 2);
} finally {
  try { fs.rmSync(btmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Component var scope is uniform: a DECLARED component (in components: []) renders with flatConfig
// as its base + its own vars on top — the same scope an inline {{COMPONENT:x}} and header/footer get
// — so config vars like {{SITE_NAME}} fill however the component is placed, and its own vars override.
const scopetmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwscope-'));
const scopeArg = scopetmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(scopetmp, p)), { recursive: true }); fs.writeFileSync(path.join(scopetmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'ScopeSite' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('components/card/card.html', '<div class="card">site={{SITE_NAME}} own={{CARD_LABEL}}</div>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', title: 'T', layout: '_layout',
    components: [{ name: 'card', vars: { CARD_LABEL: 'hello' } }] }));
  mk('pages/index/index.html', '<main>body</main>');
  fs.mkdirSync(path.join(scopetmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${scopeArg}"`, { cwd: root, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(scopetmp, 'build', 'index.html'), 'utf8');
  check('component scope: a declared component gets flatConfig base + its own vars',
    /<div class="card">site=ScopeSite own=hello<\/div>/.test(out));
} finally {
  try { fs.rmSync(scopetmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// replaceVariables is single-pass: a placeholder appearing inside a VALUE is left literal (not
// re-substituted by a later var), regardless of key order. Guards the data→template injection channel
// (untrusted text like "{{JS_SCRIPTS}}" cannot pull build internals into the page).
const sptmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwsinglepass-'));
const spArg = sptmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(sptmp, p)), { recursive: true }); fs.writeFileSync(path.join(sptmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'SP' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('components/badge/badge.html', '<div class="badge">A=[{{AAA}}] Z=[{{ZZZ}}]</div>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', title: 'T', layout: '_layout',
    components: [{ name: 'badge', vars: { AAA: 'user typed {{ZZZ}} here', ZZZ: 'SECRET' } }] }));
  mk('pages/index/index.html', '<main>{{COMPONENT:badge}}</main>');
  fs.mkdirSync(path.join(sptmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${spArg}"`, { cwd: root, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(sptmp, 'build', 'index.html'), 'utf8');
  check('replaceVariables single-pass: a {{placeholder}} inside a value stays literal',
    /A=\[user typed \{\{ZZZ\}\} here\]/.test(out) && /Z=\[SECRET\]/.test(out));
} finally {
  try { fs.rmSync(sptmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Configurable dirs: a config.json `dirs` block relocates pages/components/generators/assets + the
// output dir (defaults keep today's layout). Build a src/ + shared/assets + dist/ site.
const dirtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwdirs-'));
const dirtmpArg = dirtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(dirtmp, p)), { recursive: true }); fs.writeFileSync(path.join(dirtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'D' }, nav: [], dirs: { pages: 'src/pages', components: 'src/components', generators: 'src/generators', assets: 'shared/assets', output: 'dist' } }));
  mk('shared/assets/css/global.css', 'body{color:#123}');
  mk('src/components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body><main>{{CONTENT}}</main>{{JS_SCRIPTS}}</body></html>');
  mk('src/pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('src/pages/index/index.html', '<h1>SRC-LAYOUT-OK</h1>');
  fs.mkdirSync(path.join(dirtmp, 'shared', 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${dirtmpArg}"`, { cwd: root, stdio: 'pipe' });
  const out = fs.readFileSync(path.join(dirtmp, 'dist', 'index.html'), 'utf8');
  check('config.json `dirs` relocates pages/components/assets + the output dir',
    /SRC-LAYOUT-OK/.test(out) && /assets\/css\/global\.css/.test(out) &&
    fs.existsSync(path.join(dirtmp, 'dist', 'assets', 'css', 'global.css')));
  // `ssg add` (scaffold + material) also writes into the configured dirs, not the root defaults.
  execSync(`node cli.js add page about --site "${dirtmpArg}"`, { cwd: root, stdio: 'pipe' });
  execSync(`node cli.js add material carousel --site "${dirtmpArg}"`, { cwd: root, stdio: 'pipe' });
  check('config.json `dirs`: ssg add scaffolds + deploys into the configured dirs',
    fs.existsSync(path.join(dirtmp, 'src', 'pages', 'about', 'about.json')) &&
    fs.existsSync(path.join(dirtmp, 'src', 'components', 'carousel', 'carousel.html')) &&
    !fs.existsSync(path.join(dirtmp, 'pages')));
  // `ssg test` honours dirs.output too: it must check the relocated dist/, not a hardcoded build/.
  const dirTestOut = execSync(`node cli.js test --site "${dirtmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  check('config.json `dirs`: ssg test checks the relocated output dir (not build/)',
    /Engine checks:/.test(dirTestOut) && !/FAIL build\/ directory exists/.test(dirTestOut) &&
    /no unresolved \{\{VAR\}\} placeholders/.test(dirTestOut));
} finally {
  try { fs.rmSync(dirtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Error tally: any log.error fails the build. A missing collection source logs an error but did NOT
// bump the local buildErrors counter — the build now keys its exit off the logger's tally, so it
// exits non-zero (was a silent "completed successfully", exit 0).
const errtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwerr-'));
const errArg = errtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(errtmp, p)), { recursive: true }); fs.writeFileSync(path.join(errtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'E' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>hi</main>');
  mk('shared/database.json', JSON.stringify({ collections: [{ name: 'ghost', source: 'shared/missing', destination: 'ghost', enabled: true }] }));
  fs.mkdirSync(path.join(errtmp, 'assets', 'images'), { recursive: true });
  let errExit = 0, errOut = '';
  try { execSync(`node cli.js build --site "${errArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { errExit = e.status || 1; errOut = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('error tally: a missing collection source fails the build (exit non-zero)',
    errExit !== 0 && /Source not found/.test(errOut) && /Build FAILED/.test(errOut));
} finally {
  try { fs.rmSync(errtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Page-folder assets: nested pages get their asset copied + linked; an excluded "_"-page's asset is
// NOT copied (and cannot overwrite a live page's under "_"-stripping); an output-name collision is a
// loud error instead of a silent overwrite.
const patmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwpageassets-'));
const paArg = patmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(patmp, p)), { recursive: true }); fs.writeFileSync(path.join(patmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'PA' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/blog/post/post.json', JSON.stringify({ page: 'post', layout: '_layout', components: [] }));
  mk('pages/blog/post/post.html', '<main>post</main>');
  mk('pages/blog/post/style.css', '/* NESTED-POST */');
  mk('pages/shop/shop.json', JSON.stringify({ page: 'shop', layout: '_layout', components: [] }));
  mk('pages/shop/shop.html', '<main>shop</main>');
  mk('pages/shop/style.css', '/* SHOP-REAL */');
  mk('pages/_shop/style.css', '/* DRAFT-DO-NOT-SHIP */'); // excluded page's asset must not ship
  fs.mkdirSync(path.join(patmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${paArg}"`, { cwd: root, stdio: 'pipe' });
  const post = fs.readFileSync(path.join(patmp, 'build', 'post.html'), 'utf8');
  const shopCss = path.join(patmp, 'build', 'assets', 'css', 'pages', 'shop.css');
  check('page assets: nested page asset copied under folder-path name + linked',
    /assets\/css\/pages\/blog-post\.css/.test(post) &&
    fs.readFileSync(path.join(patmp, 'build', 'assets', 'css', 'pages', 'blog-post.css'), 'utf8').includes('NESTED-POST'));
  check('page assets: excluded "_"-page asset not shipped; live page CSS not overwritten',
    fs.readFileSync(shopCss, 'utf8').includes('SHOP-REAL') &&
    !fs.readdirSync(path.join(patmp, 'build', 'assets', 'css', 'pages')).some(f => fs.readFileSync(path.join(patmp, 'build', 'assets', 'css', 'pages', f), 'utf8').includes('DRAFT-DO-NOT-SHIP')));
  // Two different source folders mapping to the same asset name → loud build error.
  mk('pages/a-b/a-b.json', JSON.stringify({ page: 'x', layout: '_layout', components: [] }));
  mk('pages/a-b/a-b.html', '<main>x</main>');
  mk('pages/a-b/style.css', '/* AB */');
  mk('pages/a/b/b.json', JSON.stringify({ page: 'y', layout: '_layout', components: [] }));
  mk('pages/a/b/b.html', '<main>y</main>');
  mk('pages/a/b/style.css', '/* A/B */');
  let paExit = 0, paOut = '';
  try { execSync(`node cli.js build --site "${paArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { paExit = e.status || 1; paOut = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('page assets: output-name collision fails the build (not a silent overwrite)',
    paExit !== 0 && /page asset name collision/.test(paOut));
} finally {
  try { fs.rmSync(patmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Page-config validation: a normal page config missing a non-empty string `page` used to ship
// build/undefined.html silently. It now fails the build with the file path; a "_"-prefixed non-page
// JSON is still just excluded (the escape hatch), and a valid page still builds.
const pvtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwpv-'));
const pvArg = pvtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(pvtmp, p)), { recursive: true }); fs.writeFileSync(path.join(pvtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'PV' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/good/good.json', JSON.stringify({ page: 'good', title: 'Good', layout: '_layout', components: [] }));
  mk('pages/good/good.html', '<main>good</main>');
  mk('pages/nopage/nopage.json', JSON.stringify({ title: 'no page field', layout: '_layout', components: [] }));
  mk('pages/nopage/nopage.html', '<main>hi</main>');
  fs.mkdirSync(path.join(pvtmp, 'assets', 'images'), { recursive: true });
  let pvExit = 0, pvOut = '';
  try { execSync(`node cli.js build --site "${pvArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { pvExit = e.status || 1; pvOut = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('page validation: missing `page` fails the build (no undefined.html)',
    pvExit !== 0 && /not a valid page config/.test(pvOut) && /nopage\.json/.test(pvOut) &&
    !fs.existsSync(path.join(pvtmp, 'build', 'undefined.html')));
  // Rename the offender under a "_" folder → excluded; the build passes and the valid page builds.
  fs.renameSync(path.join(pvtmp, 'pages', 'nopage'), path.join(pvtmp, 'pages', '_nopage'));
  execSync(`node cli.js build --site "${pvArg}"`, { cwd: root, stdio: 'pipe' });
  check('page validation: "_"-prefixed non-page JSON is excluded; valid page builds',
    fs.existsSync(path.join(pvtmp, 'build', 'good.html')) &&
    !fs.existsSync(path.join(pvtmp, 'build', 'undefined.html')));
} finally {
  try { fs.rmSync(pvtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Output-dir guard: the build wipes dirs.output every run, so a mis-set output ("." , ".." , or a
// source dir like "pages") must FAIL loudly BEFORE the wipe — never delete site source.
const guardtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwguard-'));
const guardArg = guardtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(guardtmp, p)), { recursive: true }); fs.writeFileSync(path.join(guardtmp, p), c); };
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>precious source</main>');
  const tryBuild = (out) => {
    mk('config.json', JSON.stringify({ site: { name: 'G' }, nav: [], dirs: { output: out } }));
    let exit = 0, err = '';
    try { execSync(`node cli.js build --site "${guardArg}"`, { cwd: root, stdio: 'pipe' }); }
    catch (e) { exit = e.status || 1; err = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
    const sourceKept = fs.existsSync(path.join(guardtmp, 'pages', 'index', 'index.json'));
    return { exit, err, sourceKept };
  };
  const asPages = tryBuild('pages');
  check('output guard: output=source dir fails before wipe, source preserved',
    asPages.exit !== 0 && /contains pages\//.test(asPages.err) && asPages.sourceKept);
  const asRoot = tryBuild('.');
  check('output guard: output=site root fails, source preserved',
    asRoot.exit !== 0 && /is the site root/.test(asRoot.err) && asRoot.sourceKept);
  const asUp = tryBuild('..');
  check('output guard: output escaping the site root fails, source preserved',
    asUp.exit !== 0 && /outside the site root/.test(asUp.err) && asUp.sourceKept);
  // A valid relocated output still builds.
  mk('config.json', JSON.stringify({ site: { name: 'G' }, nav: [], dirs: { output: 'dist' } }));
  execSync(`node cli.js build --site "${guardArg}"`, { cwd: root, stdio: 'pipe' });
  check('output guard: a valid non-default output (dist) still builds',
    fs.existsSync(path.join(guardtmp, 'dist', 'index.html')) &&
    fs.existsSync(path.join(guardtmp, 'pages', 'index', 'index.json')));
} finally {
  try { fs.rmSync(guardtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// `dirs` also covers the test + log folders (the log dir supersedes log.file.dir — one place).
const tltmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwtl-'));
const tltmpArg = tltmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(tltmp, p)), { recursive: true }); fs.writeFileSync(path.join(tltmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'TL' }, nav: [], dirs: { test: 'checks', log: 'logs' }, log: { file: { format: 'jsonl' } } }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>hi</main>');
  fs.mkdirSync(path.join(tltmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js add test homepage --site "${tltmpArg}"`, { cwd: root, stdio: 'pipe' });
  const testOut = execSync(`node cli.js test --site "${tltmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  check('dirs: configurable test dir (scaffold + discovery) + log dir (sink)',
    fs.existsSync(path.join(tltmp, 'checks', 'homepage.test.js')) && !fs.existsSync(path.join(tltmp, 'test')) &&
    /homepage: homepage renders/.test(testOut) &&
    fs.existsSync(path.join(tltmp, 'logs')) && fs.readdirSync(path.join(tltmp, 'logs')).some(f => f.endsWith('.jsonl')) &&
    !fs.existsSync(path.join(tltmp, 'log')));
} finally {
  try { fs.rmSync(tltmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// `layout` accepts { name, vars } (same shape as a components entry) — layout params (e.g. header_theme)
// group under it, and the build just forwards them: header_theme is a layout var the _layout build
// script reads (build.js does NOT process it). A bare top-level `header_theme` is no longer honoured.
// title stays page-level.
const lvtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwlv-'));
const lvtmpArg = lvtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(lvtmp, p)), { recursive: true }); fs.writeFileSync(path.join(lvtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'LV' }, nav: [] }));
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body data-header-mode="{{HEADER_MODE}}">{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('components/_layout/_layout.build.js', 'module.exports = { build(vars, loadComponent, replaceVariables) { vars.HEADER_MODE = vars.header_theme || "light"; return replaceVariables(loadComponent("_layout"), vars); } };');
  mk('pages/objform/objform.json', JSON.stringify({ page: 'objform', title: 'Obj', layout: { name: '_layout', vars: { header_theme: 'dark' } }, components: [] }));
  mk('pages/objform/objform.html', '<main>obj</main>');
  mk('pages/topform/topform.json', JSON.stringify({ page: 'topform', layout: '_layout', header_theme: 'dark', components: [] }));
  mk('pages/topform/topform.html', '<main>top</main>');
  fs.mkdirSync(path.join(lvtmp, 'assets', 'images'), { recursive: true });
  execSync(`node cli.js build --site "${lvtmpArg}"`, { cwd: root, stdio: 'pipe' });
  const obj = fs.readFileSync(path.join(lvtmp, 'build', 'objform.html'), 'utf8');
  const top = fs.readFileSync(path.join(lvtmp, 'build', 'topform.html'), 'utf8');
  check('header_theme in layout.vars → HEADER_MODE (build forwards, _layout derives); bare top-level header_theme not honoured',
    /data-header-mode="dark"/.test(obj) && /<title>Obj/.test(obj) && /data-header-mode="light"/.test(top));
} finally {
  try { fs.rmSync(lvtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Phase 1 (dirs.database): the collections DB path is a configurable `dirs` entry (the one *file* key).
// A site with `dirs.database: "data/db.json"` and NO shared/database.json still copies its collections —
// proving the build reads the DB from the configured path, not the hardcoded shared/database.json.
const dbtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwdb-'));
const dbtmpArg = dbtmp.replace(/\\/g, '/');
try {
  const mk = (p, c) => { fs.mkdirSync(path.dirname(path.join(dbtmp, p)), { recursive: true }); fs.writeFileSync(path.join(dbtmp, p), c); };
  mk('config.json', JSON.stringify({ site: { name: 'DB' }, nav: [], dirs: { database: 'data/db.json' } }));
  mk('data/db.json', JSON.stringify({ collections: [{ name: 'widgets', source: 'stuff', destination: 'widgets', enabled: true }] }));
  mk('stuff/item-1/a.txt', 'hello');
  mk('components/_layout/_layout.html', '<!doctype html><html><head><title>{{PAGE_TITLE}}</title>{{CSS_LINKS}}</head><body>{{CONTENT}}{{JS_SCRIPTS}}</body></html>');
  mk('pages/index/index.json', JSON.stringify({ page: 'index', layout: '_layout', components: [] }));
  mk('pages/index/index.html', '<main>hi</main>');
  fs.mkdirSync(path.join(dbtmp, 'assets', 'images'), { recursive: true });
  let dbExit = 0;
  try { execSync(`node cli.js build --site "${dbtmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { dbExit = e.status || 1; process.stderr.write(((e.stdout || '') + '') + ((e.stderr || '') + '')); }
  check('dirs.database: build reads the collections DB from the configured file path',
    dbExit === 0 && fs.existsSync(path.join(dbtmp, 'build', 'widgets', 'item-1', 'a.txt')));
} finally {
  try { fs.rmSync(dbtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Phase 2.1 (adopt the admin): the admin now lives in catalog/ (out of shared/), and `ssg admin`
// resolves site-first via dirs.admin. A site that owns an admin runs it (fake server that exits, so
// smoke doesn't hang); a site with none warns + exits non-zero (non-TTY defaults to "no"), pointing
// at `ssg add admin`.
check('admin relocated to catalog/admin (out of shared/)',
  fs.existsSync(path.join(root, 'catalog', 'admin', 'server.js')) &&
  !fs.existsSync(path.join(root, 'shared', 'admin')));

const admtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwadmin-'));
const admtmpArg = admtmp.replace(/\\/g, '/');
try {
  // The site owns an admin at a custom dirs.admin -> ssg admin runs it (a server that exits 0).
  fs.mkdirSync(path.join(admtmp, 'tools', 'admin'), { recursive: true });
  fs.writeFileSync(path.join(admtmp, 'config.json'), JSON.stringify({ site: { name: 'AD' }, nav: [], dirs: { admin: 'tools/admin' } }));
  fs.writeFileSync(path.join(admtmp, 'tools', 'admin', 'server.js'), "console.log('SITE-ADMIN-RAN'); process.exit(0);");
  const aout = execSync(`node cli.js admin --site "${admtmpArg}"`, { cwd: root, stdio: 'pipe' }).toString();
  check('ssg admin: site-first resolution runs the site-owned admin (dirs.admin)', /SITE-ADMIN-RAN/.test(aout));
} finally {
  try { fs.rmSync(admtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

const adm2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bwadmin2-'));
const adm2Arg = adm2.replace(/\\/g, '/');
try {
  // No admin installed -> non-zero + actionable hint, no hang (non-interactive stdin => "no").
  fs.writeFileSync(path.join(adm2, 'config.json'), JSON.stringify({ site: { name: 'AD2' }, nav: [] }));
  let admExit = 0, admErr = '';
  try { execSync(`node cli.js admin --site "${adm2Arg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { admExit = e.status || 1; admErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg admin: no admin installed -> non-zero + `ssg add admin` hint (non-TTY default no)',
    admExit !== 0 && /No admin panel installed/.test(admErr) && /ssg add admin/.test(admErr));
} finally {
  try { fs.rmSync(adm2, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Phase 2.2 (ssg add admin): adopt the bundled admin into a site — copy catalog/admin -> dirs.admin and
// record dirs.admin + a minimal admin block in config.json. --no-install keeps smoke offline (the npm
// install path is verified out of band). Re-adopting needs an explicit --force; --folder repoints.
const aatmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwaddadmin-'));
const aatmpArg = aatmp.replace(/\\/g, '/');
try {
  fs.writeFileSync(path.join(aatmp, 'config.json'), JSON.stringify({ site: { name: 'AA' }, nav: [] }));
  execSync(`node cli.js add admin --no-install --site "${aatmpArg}"`, { cwd: root, stdio: 'pipe' });
  const cfg = JSON.parse(fs.readFileSync(path.join(aatmp, 'config.json'), 'utf8'));
  check('ssg add admin: copies catalog/admin -> dirs.admin + seeds config (dirs.admin + admin block)',
    fs.existsSync(path.join(aatmp, 'shared', 'admin', 'server.js')) &&
    fs.existsSync(path.join(aatmp, 'shared', 'admin', 'public', 'index.html')) &&
    cfg.dirs && cfg.dirs.admin === 'shared/admin' &&
    cfg.admin && cfg.admin.localhost_only === true && cfg.admin.port === 3000);

  // Re-run without --force (non-interactive) keeps the existing admin; --force overwrites it.
  fs.writeFileSync(path.join(aatmp, 'shared', 'admin', 'server.js'), 'MINE');
  execSync(`node cli.js add admin --no-install --site "${aatmpArg}"`, { cwd: root, stdio: 'pipe' });
  const kept = fs.readFileSync(path.join(aatmp, 'shared', 'admin', 'server.js'), 'utf8');
  execSync(`node cli.js add admin --no-install --force --site "${aatmpArg}"`, { cwd: root, stdio: 'pipe' });
  const forced = fs.readFileSync(path.join(aatmp, 'shared', 'admin', 'server.js'), 'utf8');
  check('ssg add admin: existing admin kept without --force; --force overwrites (re-copies catalog)',
    kept === 'MINE' && forced !== 'MINE' && /require\('\.\/lib\/model'\)/.test(forced));

  // --folder places the admin elsewhere and repoints dirs.admin (backups / a second admin).
  execSync(`node cli.js add admin --folder tools/adm --no-install --site "${aatmpArg}"`, { cwd: root, stdio: 'pipe' });
  const cfg2 = JSON.parse(fs.readFileSync(path.join(aatmp, 'config.json'), 'utf8'));
  check('ssg add admin: --folder places the copy + repoints dirs.admin',
    fs.existsSync(path.join(aatmp, 'tools', 'adm', 'server.js')) && cfg2.dirs.admin === 'tools/adm');

  // `admin` is an app, not a component material — `ssg add material admin` is rejected with a hint.
  let maExit = 0, maErr = '';
  try { execSync(`node cli.js add material admin --site "${aatmpArg}"`, { cwd: root, stdio: 'pipe' }); }
  catch (e) { maExit = e.status || 1; maErr = ((e.stdout || '') + '') + ((e.stderr || '') + ''); }
  check('ssg add material admin rejected (use `ssg add admin`)', maExit !== 0 && /ssg add admin/.test(maErr));
} finally {
  try { fs.rmSync(aatmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Phase 3.1 (data-model-driven admin): the admin's self-contained model helper resolves a collection's
// data_model the same way the build does — object parts parse JSON, paths list matched files, and the
// object filename is derivable for writes. (The HTTP API is exercised out of band; express is not an
// engine dependency, so smoke unit-tests the pure data layer.)
const adminModel = require('../catalog/admin/lib/model');
check('admin model: globToRegExp (literal + brace alternation, case-insensitive)',
  adminModel.globToRegExp('product.json').test('product.json') &&
  !adminModel.globToRegExp('product.json').test('product_json') &&
  adminModel.globToRegExp('*.{png,jpg,webp}').test('A.PNG'));
const amColl = { name: 'products', data_model: {
  data:   { match: 'product.json', type: 'object', required: true, schema: { name: { type: 'string' } } },
  images: { match: '*.{png,jpg,webp}', type: 'paths' }
} };
const amParts = adminModel.modelParts(amColl);
check('admin model: modelParts normalizes (type/required/schema/regex)',
  amParts.length === 2 && amParts[0].type === 'object' && amParts[0].required === true &&
  !!amParts[0].schema && amParts[1].type === 'paths' && amParts[1].required === false);
const amtmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwadminmodel-'));
try {
  fs.writeFileSync(path.join(amtmp, 'product.json'), JSON.stringify({ name: 'Widget', price: '5' }));
  fs.writeFileSync(path.join(amtmp, '1.png'), 'x');
  fs.writeFileSync(path.join(amtmp, '2.jpg'), 'x');
  fs.writeFileSync(path.join(amtmp, 'notes.txt'), 'x'); // matched by no part
  const values = adminModel.readItemParts(amtmp, amParts);
  check('admin model: readItemParts (object parsed, paths matched, unmatched ignored)',
    values.data && values.data.name === 'Widget' &&
    Array.isArray(values.images) && values.images.length === 2 &&
    values.images.includes('1.png') && values.images.includes('2.jpg') && !values.images.includes('notes.txt'));
  const globPart = { name: 'g', match: '*.json', regex: adminModel.globToRegExp('*.json'), type: 'object' };
  check('admin model: objectFileName (existing match, literal fallback, null for a glob on an empty dir)',
    adminModel.objectFileName(amtmp, amParts[0]) === 'product.json' &&
    adminModel.objectFileName(path.join(amtmp, 'nope'), amParts[0]) === 'product.json' &&
    adminModel.objectFileName(path.join(amtmp, 'nope'), globPart) === null);
} finally {
  try { fs.rmSync(amtmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

// Admin file-route part-scoping: model.filePart(parts, filename) returns the servable (non-object)
// part a filename belongs to, or null — so the file GET/DELETE routes can't reach the data file.
check('admin security: filePart scopes files to non-object parts (image ok, data file null)',
  !!adminModel.filePart(amParts, '1.png') && adminModel.filePart(amParts, 'product.json') === null &&
  adminModel.filePart(amParts, 'nope.txt') === null);

// Admin request security (pure predicates): loopback Host allowed / foreign Host blocked (DNS
// rebinding), and a state-changing cross-origin request refused (CSRF) while safe/same-origin pass.
const adminSec = require('../catalog/admin/lib/security');
check('admin security: hostAllowed only for loopback hosts',
  adminSec.hostAllowed('127.0.0.1:3000') && adminSec.hostAllowed('localhost:3000') &&
  adminSec.hostAllowed('[::1]:3000') && !adminSec.hostAllowed('evil.com') && !adminSec.hostAllowed('192.168.1.5:3000'));
check('admin security: crossOriginBlocked refuses cross-site writes, allows GET/same-origin/no-origin',
  adminSec.crossOriginBlocked('POST', 'http://evil.com', '127.0.0.1:3000') === true &&
  adminSec.crossOriginBlocked('DELETE', 'http://attacker.test', 'localhost:3000') === true &&
  adminSec.crossOriginBlocked('POST', 'not-a-url', '127.0.0.1:3000') === true &&
  adminSec.crossOriginBlocked('GET', 'http://evil.com', '127.0.0.1:3000') === false &&
  adminSec.crossOriginBlocked('POST', 'http://127.0.0.1:3000', '127.0.0.1:3000') === false &&
  adminSec.crossOriginBlocked('POST', undefined, '127.0.0.1:3000') === false);

// Phase 3.2 (field-type registry): fieldTypes drives object-part forms + server-side schema validation.
// Isomorphic (require in Node / <script> in the browser); smoke unit-tests the pure registry.
const FT = require('../catalog/admin/public/fieldTypes');
check('fieldTypes: registry has the base types; unknown -> string',
  ['string', 'text', 'number', 'boolean', 'select', 'datetime'].every(t => FT.types[t]) &&
  FT.typeOf({ type: 'nope' }) === FT.types.string);
check('fieldTypes: validate (required, number, select)',
  FT.types.string.validate('', { required: true }) === 'is required' &&
  FT.types.string.validate('x', { required: true }) === null &&
  FT.types.number.validate('abc', {}) === 'must be a number' &&
  FT.types.number.validate('3.5', {}) === null &&
  FT.types.select.validate('z', { options: ['a', 'b'] }) === 'is not one of the allowed choices' &&
  FT.types.select.validate('a', { options: ['a', 'b'] }) === null);
const ftSchema = {
  name:  { type: 'string', label: 'Name', required: true },
  price: { type: 'number', label: 'Price' },
  size:  { type: 'select', label: 'Size', options: [{ value: 's', label: 'Small' }, { value: 'l', label: 'Large' }] }
};
check('fieldTypes: validateObject aggregates messages; valid -> []',
  FT.validateObject({ name: '', price: 'x', size: 'xl' }, ftSchema).length === 3 &&
  FT.validateObject({ name: 'Widget', price: 9, size: 's' }, ftSchema).length === 0);
check('fieldTypes: input renders controls (HTML-escaped)',
  /<input type="text"[^>]*value="A&amp;B"/.test(FT.types.string.input('name', 'A&B', {})) &&
  /<textarea/.test(FT.types.text.input('d', 'x', {})) &&
  /<select[^>]*>\s*<option value="s"[^>]*>Small<\/option>/.test(FT.types.select.input('sz', 's', ftSchema.size)) &&
  /type="checkbox"[^>]* checked/.test(FT.types.boolean.input('b', true, {})));

// Phase 3.3 (frontend): the admin UI is generic + self-contained (no CDN). Structural guard — the served
// assets are wired and drive the generic API + the shared FieldTypes registry. (The browser click-through
// is manual; the API and registry the UI drives are covered above and verified out of band.)
const adminPublic = path.join(root, 'catalog', 'admin', 'public');
const idxHtml = fs.readFileSync(path.join(adminPublic, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(adminPublic, 'app.js'), 'utf8');
check('admin UI: self-contained (no CDN) + serves fieldTypes.js and wires both scripts',
  fs.existsSync(path.join(adminPublic, 'fieldTypes.js')) && !/https?:\/\//.test(idxHtml) &&
  /src="fieldTypes\.js"/.test(idxHtml) && /src="app\.js"/.test(idxHtml));
check('admin UI: generic (drives /api/collections + FieldTypes, no hardcoded product API)',
  /api\/collections/.test(appJs) && !/api\/products/.test(appJs) && /window\.FieldTypes/.test(appJs));
check('admin UI: paths parts allow multi-file select (uploadFiles loop)',
  /input\.multiple\s*=\s*true/.test(appJs) && /async function uploadFiles/.test(appJs));

done();
