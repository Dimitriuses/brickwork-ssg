#!/usr/bin/env node
// Engine CLI: `ssg <build|admin|test> [--site <dir>]`.
//
// A "site" is a directory holding config.json, pages/, assets/, shared/.
// The engine (this file, build.js, components/, lib/, admin/) is shared and
// resolved relative to this file; the build/admin code reads the site from the
// working directory, so we chdir into the site and let __dirname locate engine
// files. Default site is the current directory, so `ssg build` == `node build.js`.

const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const command = argv[0];

let site = '.';
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--site') {
    site = argv[++i] || '.';
  } else if (arg.startsWith('--site=')) {
    site = arg.slice('--site='.length);
  }
}

function fail(message) {
  console.error(message);
  console.error('Usage: ssg <build|admin|test> [--site <dir>]');
  process.exit(1);
}

if (!['build', 'admin', 'test'].includes(command)) {
  fail(command ? `Unknown command: ${command}` : 'No command given.');
}

const siteRoot = path.resolve(process.cwd(), site);
if (!fs.existsSync(siteRoot)) {
  fail(`Site directory not found: ${siteRoot}`);
}
if ((command === 'build' || command === 'test') && !fs.existsSync(path.join(siteRoot, 'config.json'))) {
  fail(`Not a site (no config.json): ${siteRoot}`);
}

// Switch into the site; engine files are still found via __dirname-relative
// requires below.
process.chdir(siteRoot);

// Configure the shared logger from config.json `log` (+ `log[command]`) and CLI flags
// (--quiet/--verbose/--no-color/--log key=value) before the build runs. Must happen before
// requiring build.js, which shares the same logger singleton.
function configureLogging(cmd) {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(path.join(siteRoot, 'config.json'), 'utf8')); } catch (e) { /* defaults */ }
  const { resolveLogOptions } = require('./lib/log-config');
  require('./lib/log').configure(resolveLogOptions(config, cmd, argv));
}

if (command === 'build') {
  configureLogging('build');
  require('./build.js');
} else if (command === 'admin') {
  require('./shared/admin/server.js');
} else { // test
  configureLogging('test');
  require('./build.js');                 // build the site at cwd (sets exitCode on failure)
  const buildOk = !process.exitCode;
  const { runSiteTests } = require('./lib/test-runner');
  const testsOk = runSiteTests(siteRoot);
  process.exit(buildOk && testsOk ? 0 : 1);
}
