// `ssg test` runner: assumes the site has just been built. It runs the engine's own
// content-agnostic checks against build/ (always on, regardless of and isolated from
// site tests - a "foolproof" baseline), then the site's own SITE_ROOT/test/*.test.js
// files. Returns true if everything passed.
//
// The engine checks are on by default; a site opts out with
//   config.json: { "test": { "engineChecks": false } }
//
// A site test exports a function (or { test }) receiving:
//   ctx = { siteRoot, buildDir, read(file), check(name, ok, detail), standardChecks }

const fs = require('fs');
const path = require('path');
const { standardChecks } = require('./checks');
const log = require('./log');

// Engine checks default ON; only an explicit `test.engineChecks: false` disables them.
// A missing/unreadable config keeps them on (fail safe).
function engineChecksEnabled(siteRoot) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(siteRoot, 'config.json'), 'utf8'));
    return !(config.test && config.test.engineChecks === false);
  } catch (error) {
    return true;
  }
}

function runSiteTests(siteRoot) {
  const buildDir = path.join(siteRoot, 'build');
  const c = log.palette; // shares the build's colour detection (--no-color/NO_COLOR/TTY)
  let passes = 0;
  let failures = 0;
  const check = (name, ok, detail) => {
    if (ok) { passes++; console.log(c.green(`  ok   ${name}`)); }
    else { failures++; console.error(c.red(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`)); }
  };

  if (engineChecksEnabled(siteRoot)) {
    console.log('Engine checks:');
    for (const r of standardChecks(buildDir)) check(r.name, r.ok, r.detail);
  } else {
    console.log('Engine checks: skipped (config test.engineChecks=false)');
  }

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

  const verdict = `${passes} passed, ${failures} failed`;
  console.log('\n' + (failures ? c.red(verdict) : c.green(verdict)));
  return failures === 0;
}

module.exports = { runSiteTests };
