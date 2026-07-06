#!/usr/bin/env node
// Engine CLI: `ssg <build|admin|test> [--site <dir>]`.
//
// A "site" is a directory holding config.json, pages/, assets/, shared/.
// The engine (this file, build.js, lib/, catalog/) is shared and
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
  else if (arg === '--register') flags.register = true;                       // add component --register
  else if (arg.startsWith('--folder=')) flags.folder = arg.slice('--folder='.length);
  else if (arg === '--folder') flags.folder = argv[++i];                      // add component --folder <dir>
  else if (arg.startsWith('--layout=')) flags.layout = arg.slice('--layout='.length);
  else if (arg === '--layout') flags.layout = argv[++i];                      // add page --layout <name>
  else if (arg.startsWith('--template=')) flags.template = arg.slice('--template='.length);
  else if (arg === '--template') flags.template = argv[++i];                  // init --template <name>
  else if (arg === '--log') i++;                 // `--log <value>`; the value is read by resolveLogOptions
  else if (!arg.startsWith('-')) positionals.push(arg);
  // other `--flags` (--quiet/--verbose/--no-color/--log=…) are consumed by resolveLogOptions.
}

function fail(message) {
  console.error(message);
  console.error('Usage: ssg <build|admin|test|add|init> [--site <dir>]');
  console.error('       ssg init [dir] [--template demo] [--force] [--dry-run]   scaffold a site into dir');
  console.error('       ssg add <page|component|generator|builder|test> <name>   scaffold new material');
  console.error('       ssg add material <name> | --all-used [--force] [--dry-run]   adopt engine material(s)');
  process.exit(1);
}

if (!['build', 'admin', 'test', 'add', 'init'].includes(command)) {
  fail(command ? `Unknown command: ${command}` : 'No command given.');
}

// `ssg init [dir]` — scaffold a site into dir (default cwd). The dir may not exist yet, so this runs
// before the site-existence checks + chdir below. `--template <name>` clones a starter repo's files
// (degit); without it, a blank buildable site is emitted.
if (command === 'init') {
  const targetDir = path.resolve(process.cwd(), positionals[0] || '.');
  require('./lib/log').configure(require('./lib/log-config').resolveLogOptions({}, 'init', argv));
  const log = require('./lib/log');
  const opts = { force: flags.force, dryRun: flags.dryRun };
  const verb = flags.dryRun ? 'would create' : 'created';
  const rel = path.relative(process.cwd(), targetDir) || '.';

  let result, source, nextHint;
  try {
    if (flags.template) {
      result = require('./lib/init-template').initFromTemplate(flags.template, targetDir, opts);
      source = `from template "${flags.template}"`;
      nextHint = `next: cd ${rel}, wire the engine submodule (git init; git submodule update --init --recursive, or git submodule add <engine-url> engine), then \`npm run build\``;
    } else {
      result = require('./lib/scaffold').scaffoldInit(targetDir, opts);
      source = 'blank site';
      nextHint = 'next: add the engine as a submodule (git submodule add <url> engine), then `npm run build`';
    }
  } catch (e) {
    log.error(e.message, { phase: 'init' });
    process.exit(1);
  }

  result.created.forEach(f => log.info(`  + ${f}`, { phase: 'init' }));
  result.skipped.forEach(f => log.debug(`  = ${f} (exists — use --force to overwrite)`, { phase: 'init' }));
  log.flushWarnings();
  log.success(`${verb} ${result.created.length} file(s) — ${source} in ${rel}${result.skipped.length ? `, ${result.skipped.length} skipped` : ''}`, { phase: 'init' });
  if (!flags.dryRun && result.created.length) log.info(nextHint, { phase: 'init' });
  process.exit(0);
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
  const KINDS = ['page', 'component', 'generator', 'builder', 'test', 'material'];
  const kind = positionals[0];
  const name = positionals[1];
  if (!KINDS.includes(kind)) {
    fail((kind ? `unknown kind "${kind}". ` : 'no kind given. ') + `add kind must be one of: ${KINDS.join(', ')}`);
  }

  if (kind === 'material') {
    // Adopt an existing engine-catalog material: copy it into the site (per-file gap-fill, drift-aware).
    // The deployable source is the engine `catalog/` (not the build's slim `components/`).
    const { deployMaterial } = require('./lib/deploy');
    const engineCatalogDir = path.join(__dirname, 'catalog');
    const deployOpts = {
      engineComponentsDir: engineCatalogDir,
      siteComponentsDir: require('./lib/dirs').siteDirs(siteRoot).components, // configurable via `dirs`
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
      const { folders } = usedComponentNames({ siteRoot, engineRoot: __dirname, engineComponentsDir: engineCatalogDir, log });
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

    if (!name) fail('ssg add material <name>   (or: ssg add material --all-used)');
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
  }

  // Author-new kinds (page / component / generator / builder): scaffold starter stubs.
  const { scaffold } = require('./lib/scaffold');
  if (!name) fail(`ssg add ${kind} <name>   (name required)`);
  let result;
  try {
    result = scaffold(kind, name, {
      siteRoot, engineRoot: __dirname,
      opts: { force: flags.force, register: flags.register, folder: flags.folder, layout: flags.layout },
      dryRun: flags.dryRun
    });
  } catch (e) {
    log.error(e.message, { phase: 'add' });
    process.exit(1);
  }
  const verb = flags.dryRun ? 'would create' : 'created';
  result.created.forEach(f => log.info(`  + ${f}`, { phase: 'add' }));
  result.registered.forEach(r => log.info(`  ~ ${r}`, { phase: 'add' }));
  result.skipped.forEach(f => log.debug(`  = ${f} (exists — use --force to overwrite)`, { phase: 'add' }));
  log.flushWarnings();
  const extra = result.skipped.length ? `, ${result.skipped.length} skipped` : '';
  log.success(`${verb} ${result.created.length} file(s) for ${kind} "${name}"${extra}`, { phase: 'add' });
  process.exit(0);
} else if (command === 'build') {
  configureLogging('build');
  require('./build.js');
} else if (command === 'admin') {
  // Resolve the admin site-first: run the site's own copy (dirs.admin, default shared/admin) if it
  // owns one; otherwise offer the engine's bundled default (catalog/admin). A missing site admin on a
  // non-interactive stdin defaults to "no" (don't launch), so scripts never hang on the prompt.
  const siteAdminDir = require('./lib/dirs').siteDirs(siteRoot).admin;
  const relAdmin = path.relative(siteRoot, siteAdminDir) || '.';
  const siteServer = path.join(siteAdminDir, 'server.js');
  const defaultServer = path.join(__dirname, 'catalog', 'admin', 'server.js');

  // Start an admin server in-process; a missing dependency set is the usual failure, so hint at it.
  const launch = (serverPath, installDir) => {
    try { require(serverPath); }
    catch (e) {
      if (e && e.code === 'MODULE_NOT_FOUND') {
        console.error(`Admin dependencies are not installed. Run:  npm --prefix "${installDir}" install`);
        process.exit(1);
      }
      throw e;
    }
  };

  if (fs.existsSync(siteServer)) {
    launch(siteServer, siteAdminDir);                       // the site owns an admin — run it
  } else {
    console.error(`No admin panel installed at ${relAdmin}/ (dirs.admin).  Install one with:  ssg add admin`);
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Launch the bundled default admin instead? (y/N) ', (answer) => {
        rl.close();
        if (/^y(es)?$/i.test(String(answer).trim())) launch(defaultServer, __dirname);
        else process.exit(1);
      });
    } else {
      console.error('(non-interactive: not launching the default — run interactively to use it.)');
      process.exit(1);
    }
  }
} else { // test
  configureLogging('test');
  require('./build.js');                 // build the site at cwd (sets exitCode on failure)
  const buildOk = !process.exitCode;
  const { runSiteTests } = require('./lib/test-runner');
  const testsOk = runSiteTests(siteRoot);
  process.exit(buildOk && testsOk ? 0 : 1);
}
