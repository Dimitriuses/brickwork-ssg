# Terminal output system — draft plan (for discussion)

> **Status: draft.** A deeper design for the **"Build/test output overhaul (terminal UX)"** roadmap
> item — the custom output module idea. Builds on
> [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §4 (the traffic-light colour
> system) and generalises the v0.4 `deferWarning` / `flushDeferredWarnings` grouping. Nothing here is
> decided. The headline is: **route all CLI output through one small module** instead of scattered
> `console.log`.

## The idea

A purpose-built **output module** (working name `lib/log.js`) that every build/test line flows
through, replacing direct `console.log` / `console.error`. It exposes a tiny severity API —
`log.success`, `log.info`, `log.warn`, `log.error` (and probably `log.debug`) — and it **collects,
groups, and renders** messages rather than printing each one blindly. Operating modes (`--quiet`,
`--verbose`) and colour live in this one place.

> Naming note: you wrote `.warm` — assuming that's `.warn` (the amber/warning level). Final names
> are an open question (`log` vs `report` vs `out`/`ui`).

## Why this is worth doing

- Today there are ~**35 `console.log` + ~10 `console.error`** in `build.js` alone, with `[TAG]`
  prefixes that mix *phase* (`[BUILD]`, `[TEMPLATE]`, `[MODEL]`) and *severity* (`[WARNING]`,
  `[ERROR]`), no severity model, no verbosity levels, and no colour. `deferWarning` is a one-off that
  only handles warnings.
- A single chokepoint means: consistent formatting everywhere, colour/levels for free, and every
  future improvement to build/test/admin messages lands in one edit instead of dozens.
- It turns "output" from an afterthought into a small, testable component — which is the right
  altitude for a tool whose whole value proposition is *legible, no-magic builds*.

## The module

**Location.** `lib/log.js` — part of the **slim core** (build machinery), never a deployable
material. Zero-dependency: a small custom module, **not** a logging framework (no winston/pino, no
chalk).

**Surface (first cut).**

```js
const log = require('./lib/log');

log.success('built 51 pages', { phase: 'build' });
log.info('products: shared/products → products (41 items)', { phase: 'collections' });
log.warn('no `copy` — files will not ship', { phase: 'collections', group: 'products',
                                              hint: 'set copy:true to ship or copy:false to silence' });
log.error('source collection "off" is disabled', { phase: 'templates' });
log.debug('resolved component carousel site-first', { phase: 'assets' });

log.summary();          // verdict line + counts, coloured by worst severity
process.exit(log.errorCount ? 1 : 0);
```

**Message record.** Each call appends a structured record, not a string:

```js
{ level: 'warn', message: '…', phase: 'collections', group: 'products', hint: '…', count: 1 }
```

The second arg is the **"parameters"** you described: the context the reporter sorts/groups by
(`phase`, an optional `group` key, a `hint`/action). De-duplication by message bumps `count`
(generalising `flushDeferredWarnings`).

> **Confirm the grouping dimension.** I read "messages related to parameters" as *each message
> carries structured parameters (severity + phase + group), and the reporter collects/sorts/renders
> by them.* If you meant something narrower (e.g. group strictly by collection, or by CLI flag),
> say so — it changes the record shape.

## Collect → sort → display

- **Collect.** Every call appends a record to an in-memory buffer. **Errors also stream
  immediately** (so a crash still surfaces them); in `--verbose`, `info`/`debug` stream live too.
- **Sort / group.** At flush: group by **phase order** (collections → pages → templates → checks),
  then by severity within a phase; collapse repeats into `count`. This is the v4 grouped-warning
  behaviour made general.
- **Display.** Per-phase sections, grouped warnings with counts + hints, then a **summary line
  coloured by the worst level seen**: 🟢 "built N pages, 0 warnings" / 🟡 "… N warnings" / 🔴 "build
  FAILED: M errors". Colour comes from `lib/colors.js` (raw ANSI, traffic-light — see the tooling
  draft §4a).

## Operating modes

A single **level**, resolved once at startup from argv/env:

| Mode | Shows |
|---|---|
| `--quiet` | errors + the final summary only |
| default | phase headers, grouped warnings, summary (today's signal, minus per-item chatter) |
| `--verbose` | everything: per-item `[BUILD]` lines, timings, resolved paths, `debug` |

Plus `--no-color` / `NO_COLOR` / `FORCE_COLOR` (handled in `lib/colors.js`). The logger stores the
resolved level; `log.debug`/`log.info` no-op below their threshold.

## Streams & exit code

- `success`/`info`/`warn` → **stdout**; `error` → **stderr** (clean separation for pipes/CI).
- The logger **owns the error tally** → it drives the process exit code (replacing the ad-hoc
  `buildErrors` counter). Correctness keys off the *count*, never off matching printed strings.
- **Flush on exit** (a `try/finally` around the run, or a `process.on('exit')` hook) so buffered
  output isn't lost if the build throws mid-phase.

## Migration (incremental, mechanical)

1. Land `lib/colors.js` + `lib/log.js` (`success/info/warn/error/debug` + `summary`); wire colour.
2. Replace `build.js` `console.log`→`log.info`/`log.success`, `console.error`→`log.error`, and fold
   `deferWarning`/`flushDeferredWarnings` into `log.warn` + the grouped flush. Do it **phase by
   phase** (collections, then pages, then templates, then checks) so each slice is reviewable.
3. Add `--quiet` / `--verbose` / `--no-color`.
4. Route `ssg test` (`ok`/`FAIL`, `N passed/M failed`) and the admin server through the same module.
5. Optionally expose a scoped logger to build scripts (see below).

**Keep message text stable** during the move so the test suite keeps matching (see caveats).

## Notes on the other Tooling & Distribution tasks

- **Slim core / deploy (task 1).** `lib/log.js` stays in the **core**, never deployed — it's
  machinery, not content. Good litmus test for "what is core": the build can't narrate itself
  without it.
- **Plugins / build scripts (task 3).** Extend the build-script helpers (4th arg) with a **scoped
  logger** — e.g. `helpers.warn(msg, { hint })` that auto-tags `group: <componentName>`. Then a
  material reports *through* the system (attributed + grouped) instead of `console.log`, which also
  gives third-party materials a sanctioned, well-behaved output channel (ties into the trust
  boundary). Additive and backward-compatible — existing scripts that `console.log` still work; we'd
  migrate the engine's own scripts first.
- **`ssg init` (task 2).** No direct dependency, but `init`/`add` are exactly the commands that
  benefit from clear success/next-step messaging — another reason to build the module before them.

## Caveats / watch-items

- **The test suite reads stdout.** `test/smoke.js` regex-matches **exact warning/error strings**, and
  the engine's always-on checks scan build output. A logger that buffers, reformats, or `--quiet`s
  can silently break these. Mitigations: (a) keep message text stable across the migration; (b) add a
  **test capture mode** so assertions run against structured *records*, not formatted stdout; (c)
  ensure the default level still emits everything the tests expect. Treat this as the main risk.
- **Buffering vs. crashes.** Deferring output means a mid-build throw could swallow it — stream
  errors immediately and flush on exit.
- **Order changes.** Grouped output is no longer strictly chronological; that's the point, but it can
  confuse debugging — `--verbose` should stream live in source order.
- **stdout/stderr interleaving.** When both are a TTY, grouped stdout + immediate stderr can
  intermix; acceptable, but worth a deliberate flush order.
- **Windows ANSI.** Modern Windows terminals (the dev box is Win10) render ANSI fine; legacy
  `conhost` may not. `isTTY` + `NO_COLOR` detection covers it — never *assume* colour.
- **Scope discipline.** Resist turning this into a framework (transports, JSON sinks, config files).
  Builds are sub-second; favour a ~100-line module over cleverness. A `--json` output mode for CI
  tooling is a plausible *later* addition — note it, don't build it yet.
- **Don't over-tag.** Three severities + a phase + an optional group is enough; more axes make the
  reporter (and the call sites) noisy.

## Open questions

- Module + method names (`log.success/info/warn/error/debug`? `report`? `ui`?).
- Is **phase** tracked implicitly (`log.phase('build')` sets a current phase) or passed per call?
- Exact meaning of "**related to parameters**" — confirm the grouping dimension(s).
- Does `ssg test` share the build logger instance, or get its own with the same module?
- A future `--json` / machine-readable mode — in scope or explicitly deferred?
