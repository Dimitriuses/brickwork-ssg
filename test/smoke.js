// Engine smoke test: builds the bundled example/ site and asserts content-
// agnostic invariants. No test framework; exits non-zero on any failure so CI
// catches regressions. Run with `npm test`.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { standardChecks } = require('../lib/checks');

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
// Phase C: a site-authored generator (example/generators/news.build.js) emits
// pages via generate(ctx); the pricing build script used the helpers (raw) - if
// helpers weren't passed it would have thrown and failed the build.
check('site generator emitted pages', fs.readdirSync(buildDir).some(f => /^news-.*\.html$/.test(f)));

// v0.2.1: generators resolve site-first by filename. example/generators ships its
// own generate-custom.build.js (same name as the engine's). The site one must run
// and the engine's must be shadowed (its "[CUSTOM-PAGES]" log must not appear).
check('site generator shadows engine one (site ran)', fs.existsSync(path.join(buildDir, 'custom-demo.html')));
check('site generator shadows engine one (engine skipped)',
  buildOut.includes('[EXAMPLE-CUSTOM]') && !buildOut.includes('[CUSTOM-PAGES]'));
// v0.2.1: product-detail.css/js resolve site-first too. example/generators ships a
// product-detail.css whose marker must reach the built product pages' asset.
const productDetailCss = path.join(buildDir, 'assets', 'css', 'pages', 'product-detail.css');
check('product-detail asset resolves site-first',
  fs.existsSync(productDetailCss) &&
  fs.readFileSync(productDetailCss, 'utf8').includes('product-detail-site-marker'));

done();
