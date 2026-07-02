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
const positionals = [];   // non-flag args (e.g. the material name for `add`)
const flags = {};         // --force / --dry-run
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--site') site = argv[++i] || '.';
  else if (arg.startsWith('--site=')) site = arg.slice('--site='.length);
  else if (arg === '--force') flags.force = true;
  else if (arg === '--dry-run') flags.dryRun = true;
  else if (arg === '--all-used') flags.allUsed = true;
  else if (arg === '--log') i++;                 // `--log <value>`; the value is read by resolveLogOptions
  else if (!arg.startsWith('-')) positionals.push(arg);
  // other `--flags` (--quiet/--verbose/--no-color/--log=…) are consumed by resolveLogOptions.
}

function fail(message) {
  console.error(message);
  console.error('Usage: ssg <build|admin|test|add> [--site <dir>]');
  console.error('       ssg add <name> [--force] [--dry-run]   deploy a material into the site');
  process.exit(1);
}

if (!['build', 'admin', 'test', 'add'].includes(command)) {
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

if (command === 'add') {
  configureLogging('add');
  const log = require('./lib/log');
  const { deployMaterial } = require('./lib/deploy');
  const deployOpts = {
    engineComponentsDir: path.join(__dirname, 'components'),
    siteComponentsDir: path.join(siteRoot, 'components'),
    force: flags.force,
    dryRun: flags.dryRun
  };
  const verb = flags.dryRun ? 'would add' : 'added';

  // Log one material's per-file result; returns its { copied, drifted } counts.
  const report = (material, res) => {
    res.copied.forEach(f => log.info(`  + ${material}/${f}`, { phase: 'add' }));
    res.skipped.forEach(f => log.debug(`  = ${material}/${f} (identical)`, { phase: 'add' }));
    res.drifted.forEach(f => log.warn(`${material}/${f} differs from the engine catalog — left as-is (use --force to overwrite)`, { phase: 'add' }));
    return { copied: res.copied.length, drifted: res.drifted.length };
  };

  if (flags.allUsed) {
    // Own every material this site uses but inherits from the engine (the migration bridge).
    const { usedComponentNames } = require('./lib/used-materials');
    const { folders } = usedComponentNames({ siteRoot, engineRoot: __dirname, log });
    let copied = 0, drifted = 0, materials = 0;
    for (const folder of folders) {
      const res = deployMaterial(folder, deployOpts);
      if (!res.exists) continue; // site-authored (engine has no such folder) — already owned
      materials++;
      const c = report(folder, res); copied += c.copied; drifted += c.drifted;
    }
    log.flushWarnings();
    log.success(`${verb} ${copied} file(s) across ${materials} material(s)${drifted ? `, ${drifted} drifted` : ''}`, { phase: 'add' });
    process.exit(0);
  }

  const name = positionals[0];
  if (!name) fail('ssg add <name> [--force] [--dry-run]   (or: ssg add --all-used)');
  const res = deployMaterial(name, deployOpts);
  if (!res.exists) { log.error(`no material "${name}" in the engine catalog`, { phase: 'add' }); process.exit(1); }
  const c = report(name, res);
  log.flushWarnings();
  const extra = [
    res.skipped.length ? `${res.skipped.length} identical` : '',
    c.drifted ? `${c.drifted} drifted` : ''
  ].filter(Boolean).join(', ');
  log.success(`${verb} ${c.copied} file(s) for "${name}"${extra ? ` (${extra})` : ''}`, { phase: 'add' });
  process.exit(0);
} else if (command === 'build') {
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
