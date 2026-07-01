'use strict';
// Custom build/test output module — the one place CLI output flows through. It records structured
// entries, streams by level, defers + de-duplicates warnings into an end-of-run block, and renders
// a colour-coded summary. Zero-dependency. Full design + decisions: docs/terminal-ux-plan.md.
//
// Record shape (also the future `jsonl` line):
//   { timestamp, phase, level, logger, message, metadata }
// - level:  SUCCESS | INFO | WARNING | ERROR | DEBUG  (UPPERCASE)
// - logger: coarse origin (subsystem);  metadata.source: fine origin (file/name)
// - metadata is open — the renderer looks for well-known keys (source/group/hint/count) and keeps
//   the rest for the record/file.

const colors = require('./colors');

// Verbosity modes, ranked. A render category prints when the mode's rank >= the category's minimum.
const MODE_RANK = { quiet: 0, normal: 1, verbose: 2 };

// Single editable mapping: render category -> minimum mode at which it prints. Timings show at all
// levels; per-item info + debug are verbose-only. Change visibility here, not at the call sites.
const CATEGORY_MIN_MODE = {
  error: 'quiet',
  summary: 'quiet',
  timing: 'quiet',
  success: 'normal',
  warning: 'normal',
  info: 'normal',    // progress narration ([COLLECTIONS], [MODEL], [TEMPLATE] built N, …)
  debug: 'verbose'   // per-item detail ([BUILD] <page>, resolved paths) + diagnostics
};

function createLogger() {
  let mode = 'normal';
  let policy = 'auto';
  let out = colors.palette(false); // stdout palette
  let err = colors.palette(false); // stderr palette
  let capture = false;             // when true, records but does not print (for tests)

  const state = {
    records: [],                   // every record, in order (capture / future file sink)
    warnings: new Map(),           // message -> { count } (deferred + de-duplicated)
    counts: { SUCCESS: 0, INFO: 0, WARNING: 0, ERROR: 0, DEBUG: 0 },
    start: Date.now()
  };

  // Resolve the level→visibility inputs and (re)build the palettes for the current streams.
  function configure(opts = {}) {
    if (opts.mode && opts.mode in MODE_RANK) mode = opts.mode;
    if (opts.color) policy = opts.color;
    if (typeof opts.capture === 'boolean') capture = opts.capture;
    out = colors.palette(colors.shouldColor(policy, process.stdout));
    err = colors.palette(colors.shouldColor(policy, process.stderr));
    return api;
  }

  // Start a fresh run (clears records/warnings/counts, resets the clock). Callers own the lifecycle.
  function begin(opts = {}) {
    state.records = [];
    state.warnings.clear();
    state.counts = { SUCCESS: 0, INFO: 0, WARNING: 0, ERROR: 0, DEBUG: 0 };
    state.start = Date.now();
    configure(opts);
    return api;
  }

  function shows(category) {
    return MODE_RANK[mode] >= MODE_RANK[CATEGORY_MIN_MODE[category]];
  }

  function toRecord(level, message, meta) {
    const m = meta || {};
    const metadata = {};
    for (const k in m) if (k !== 'phase' && k !== 'logger') metadata[k] = m[k];
    const rec = {
      timestamp: new Date().toISOString(),
      phase: m.phase || null,
      level,
      logger: m.logger || 'engine',
      message,
      metadata
    };
    state.records.push(rec);
    state.counts[level] = (state.counts[level] || 0) + 1;
    return rec;
  }

  function write(stream, text) {
    if (!capture) stream.write(text + '\n');
  }

  // Leveled API -------------------------------------------------------------
  // Errors stream immediately (real time), to stderr.
  function error(message, meta) {
    const rec = toRecord('ERROR', message, meta);
    write(process.stderr, `${err.red('[ERROR]')} ${message}`);
    return rec;
  }
  // Warnings are deferred + de-duplicated, flushed as a group before the summary.
  function warn(message, meta) {
    const rec = toRecord('WARNING', message, meta);
    const cur = state.warnings.get(message);
    if (cur) cur.count += 1; else state.warnings.set(message, { count: 1 });
    return rec;
  }
  function success(message, meta) {
    const rec = toRecord('SUCCESS', message, meta);
    if (shows('success')) write(process.stdout, out.green(message));
    return rec;
  }
  function info(message, meta) {
    const rec = toRecord('INFO', message, meta);
    if (shows('info')) write(process.stdout, message);
    return rec;
  }
  function debug(message, meta) {
    const rec = toRecord('DEBUG', message, meta);
    if (shows('debug')) write(process.stdout, out.dim(message));
    return rec;
  }

  // Deferred-warnings block. Message text is kept identical to the legacy flush (colour aside),
  // so anything that greps build output keeps matching.
  function flushWarnings() {
    if (state.warnings.size === 0) return;
    write(process.stdout, ''); // blank separator line (kept outside the colour span)
    write(process.stdout, out.yellow('[WARNINGS] review these (they may need action):'));
    for (const [message, { count }] of state.warnings) {
      write(process.stdout, out.yellow(`  - ${message}${count > 1 ? ` (x${count})` : ''}`));
    }
  }

  // Final verdict: flush the warnings group, then the summary block (coloured by outcome). Text is
  // byte-identical to the legacy summary when colour is off.
  function summary(opts = {}) {
    const pagesBuilt = opts.pagesBuilt || 0;
    const errors = opts.errors || 0;
    const elapsedMs = typeof opts.elapsedMs === 'number' ? opts.elapsedMs : (Date.now() - state.start);
    const secs = (elapsedMs / 1000).toFixed(2);

    flushWarnings();
    write(process.stdout, '\n========================================');
    if (errors > 0) {
      write(process.stderr, err.red(`Build FAILED: ${errors} error(s)`));
      write(process.stdout, `Pages built: ${pagesBuilt}`);
      write(process.stdout, `Build time: ${secs}s`);
      write(process.stdout, '========================================\n');
    } else {
      write(process.stdout, out.green('Build completed successfully'));
      if (opts.outputDir) write(process.stdout, `Output directory: ${opts.outputDir}`);
      write(process.stdout, `Pages built: ${pagesBuilt}`);
      write(process.stdout, `Build time: ${secs}s`);
      write(process.stdout, '========================================\n');
    }
  }

  const api = {
    configure,
    begin,
    success,
    info,
    warn,
    error,
    debug,
    flushWarnings,
    summary,
    // Introspection for tests / future sinks.
    records: () => state.records.slice(),
    counts: () => Object.assign({}, state.counts),
    get errorCount() { return state.counts.ERROR; }
  };
  return api;
}

// The engine shares one logger instance; createLogger is exported for isolated tests.
const logger = createLogger();
logger.configure();          // detect colour from the real streams on load
logger.createLogger = createLogger;
module.exports = logger;
