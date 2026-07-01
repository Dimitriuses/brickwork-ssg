'use strict';
// Resolve logger options (verbosity `mode` + colour `color`) from layered sources for a command:
//   defaults -> config.json `log` -> config.json `log[command]` -> CLI flags.
// Environment (NO_COLOR / FORCE_COLOR) is applied later, inside colors.shouldColor, when
// color === 'auto'. Pure + side-effect-free so it can be unit-tested. See docs/terminal-ux-plan.md.

const DEFAULTS = { mode: 'normal', color: 'auto' };

function applyBlock(opts, block) {
  if (!block || typeof block !== 'object') return;
  if (block.level) opts.mode = block.level;
  if (block.color) opts.color = block.color;
  if ('file' in block) opts.file = block.file; // false | true | { dir, path, level, format, retention }
}

// Ensure opts.file is a mutable object (promoting `true`/absent), then return it.
function fileObject(opts) {
  if (!opts.file || opts.file === true) opts.file = {};
  return opts.file;
}

// Parse `--log key=value` payload(s): comma-joined pairs, first `=` splits key/value.
function applyPairs(opts, value) {
  if (!value) return;
  String(value).split(',').forEach(pair => {
    if (!pair) return;
    const eq = pair.indexOf('=');
    const key = (eq >= 0 ? pair.slice(0, eq) : pair).trim();
    const val = (eq >= 0 ? pair.slice(eq + 1) : '').trim();
    if (key === 'level') opts.mode = val;
    else if (key === 'color') opts.color = val;
    else if (key === 'file') {
      if (val === 'false') opts.file = false;
      else if (val === 'true' || val === '') fileObject(opts);
      else fileObject(opts).path = val;
    } else if (key === 'format' || key === 'dir') {
      fileObject(opts)[key] = val; // implies a file sink
    }
    // unknown keys are ignored (no crash).
  });
}

// config: parsed config.json (or {}); command: 'build' | 'test'; args: process.argv.slice(2).
// Later sources win; unknown values are passed through and validated by the logger (invalid mode is
// ignored, unknown colour policy falls back to auto).
function resolveLogOptions(config, command, args) {
  const opts = Object.assign({}, DEFAULTS);
  const log = (config && config.log) || {};
  applyBlock(opts, log);              // shared log.*
  applyBlock(opts, log[command]);     // per-command log.build / log.test

  for (let i = 0; i < (args || []).length; i++) {
    const a = args[i];
    if (a === '--quiet' || a === '-q') opts.mode = 'quiet';
    else if (a === '--verbose' || a === '-v') opts.mode = 'verbose';
    else if (a === '--no-color') opts.color = 'never';
    else if (a === '--log') applyPairs(opts, args[++i]);
    else if (a.startsWith('--log=')) applyPairs(opts, a.slice('--log='.length));
  }
  return opts;
}

module.exports = { resolveLogOptions, DEFAULTS };
