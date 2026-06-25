// `ssg test` runner: assumes the site has just been built, runs the reusable
// standard checks against build/, then runs the site's own SITE_ROOT/test/*.test.js
// files. Returns true if everything passed.
//
// A site test exports a function (or { test }) receiving:
//   ctx = { siteRoot, buildDir, read(file), check(name, ok, detail), standardChecks }

const fs = require('fs');
const path = require('path');
const { standardChecks } = require('./checks');

function runSiteTests(siteRoot) {
  const buildDir = path.join(siteRoot, 'build');
  let passes = 0;
  let failures = 0;
  const check = (name, ok, detail) => {
    if (ok) { passes++; console.log(`  ok   ${name}`); }
    else { failures++; console.error(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); }
  };

  console.log('Standard checks:');
  for (const r of standardChecks(buildDir)) check(r.name, r.ok, r.detail);

  const testDir = path.join(siteRoot, 'test');
  const testFiles = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter(f => f.endsWith('.test.js'))
    : [];

  if (testFiles.length) {
    console.log('\nSite tests:');
    const read = (file) => {
      const p = path.join(buildDir, file);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    };
    const ctx = { siteRoot, buildDir, read, check, standardChecks };
    for (const f of testFiles) {
      try {
        const abs = path.resolve(testDir, f);
        delete require.cache[abs];
        const mod = require(abs);
        const fn = typeof mod === 'function' ? mod : mod.test;
        if (typeof fn === 'function') fn(ctx);
        else check(`${f} exports a test function`, false);
      } catch (error) {
        check(`${f} ran without throwing`, false, error.message);
      }
    }
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  return failures === 0;
}

module.exports = { runSiteTests };
