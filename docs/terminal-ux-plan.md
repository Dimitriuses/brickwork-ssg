# Terminal output system — draft plan (for discussion)

> **Status: draft.** A deeper design for the **"Build/test output overhaul (terminal UX)"** roadmap
> item — the custom output module idea. Builds on
> [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §4 (the traffic-light colour
> system) and generalises the v0.4 `deferWarning` / `flushDeferredWarnings` grouping. Nothing here is
> decided. The headline is: **route all CLI output through one small module** instead of scattered
> `console.log`.

## The idea

A purpose-built **output module** — **`lib/log.js`** (name decided) — that every build/test line
flows through, replacing direct `console.log` / `console.error`. It exposes a tiny severity API —
`log.success`, `log.info`, `log.warn`, `log.error` (and probably `log.debug`) — and it **collects,
groups, and renders** messages rather than printing each one blindly. Verbosity (`--quiet` /
`--verbose`), colour, and an optional file sink are configured **in `config.json` and overridable per
run on the command line** (see [Configuration](#configuration-configjson--flags)).

> Naming note: you wrote `.warm` — taken as `.warn` (the amber/warning level).

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

The second arg is the **"parameters"** you described: the context the reporter sorts/groups by.
**Decided: group by `level` (severity) + `phase`.** `phase` is **passed per call** (the producer
knows its phase; the logger doesn't track a hidden "current phase"). `group` (an optional finer key,
e.g. the collection or component name) and `hint`/action ride along for rendering and de-duplication
— repeats of the same message bump `count` (generalising `flushDeferredWarnings`).

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

A single **level**, resolved once at startup (see [Configuration](#configuration-configjson--flags)
for where the value comes from):

| Level | Shows |
|---|---|
| `quiet` | errors + the final summary only |
| `normal` (default) | phase headers, grouped warnings, summary (today's signal, minus per-item chatter) |
| `verbose` | everything: per-item `[BUILD]` lines, timings, resolved paths, `debug` |

Plus a colour policy (`auto` / `always` / `never`, handled in `lib/colors.js`). The logger stores
the resolved level; `log.debug`/`log.info` no-op below their threshold.

## Configuration (config.json + flags)

You asked whether a `config.json` log block earns its keep once there's a CLI flag. **It does — they
serve different jobs, and they layer.** The principle:

- **`config.json` = the project's persistent, committed stance** — what should be true on *every*
  run and *shared by the team* (a default level; a colour policy; a log-file sink).
- **CLI flags = a per-invocation override** — "just this once, verbose" / "no colour in this pipe".
- **Defaults make both optional** — with no `log` block and no flags, sensible defaults apply
  (`normal`, colour `auto`, no file). The zero-config build keeps working untouched.

The rule of thumb for "config or flag?": if a setting is a **project-wide stance** (always write a
JSON build log; this project builds quietly), it belongs in `config.json`. If it only ever makes
sense **for one run**, it's a flag and shouldn't clutter config.

**The feature that actually justifies `config.json` (and that a flag serves poorly): a persistent
file sink.** "Always tee a full/JSON log to `build.log`" is something you want committed and not
retyped — and it's where your original **CI/CD** motivation really lands. A machine-readable log
*file* declared once in config beats a wall of CLI flags on every CI invocation.

### Proposed structure

A single top-level **`log`** object, with shared keys plus optional per-command overrides — DRY
(set once, tweak per command) and discoverable (all output config in one place):

```jsonc
{
  // … existing keys: name, nav, site, contact, social …
  "test": { "engineChecks": true },     // stays put — a test *behaviour*, not output config

  "log": {
    "level": "normal",                  // "quiet" | "normal" | "verbose"
    "color": "auto",                    // "auto" | "always" | "never"
    "file":  null,                      // off, or a sink object (below)

    // optional per-command overrides; each inherits the shared keys above
    "build": { },
    "test":  { "level": "quiet" }
  }
}
```

A file sink, when you want one:

```jsonc
"file": { "path": "build.log", "level": "verbose", "format": "text" }   // format: "text" | "json"
```

- The file is **always un-coloured** (ANSI stripped) and may run at a **higher level than the
  console** — e.g. console `normal` (just the summary on screen) while the file captures `verbose`.
- `format: "json"` is the natural home for the deferred **machine-readable** mode: structured records
  to disk for CI to ingest, while humans still get the pretty console output. Build it when a real CI
  need shows up; the shape just falls out of the message records.

### Resolution order (low → high)

1. **built-in defaults** (`normal`, `auto`, no file)
2. **`config.json` `log.*`** (shared)
3. **`config.json` `log.<command>.*`** (`build` / `test`)
4. **environment** — `NO_COLOR` / `FORCE_COLOR` (the de-facto standards) for the colour axis
5. **CLI flags** — highest, this run only

### The command-line override

Keep the ergonomic shortcuts **`--quiet` / `--verbose` / `--no-color`** for the common cases. For the
rest, a general **`--log`** flag (your placeholder name) mirrors the config fields for one run, e.g.:

```bash
ssg build --log level=verbose,file=run.log,format=json
ssg build --quiet                 # shorthand for --log level=quiet
```

Discrete `--log-level` / `--log-file` / `--log-color` are the discoverable alternative; the exact
flag spelling is still open. Whatever the form, it sets the **top layer** of the resolution above.

### `ssg test`

`ssg test` **shares the one build-logger instance** (it runs a build, then checks + site tests). Its
output is **separated by the `phase` tag** — build phases render first, then a `checks` section and a
`tests` section — so it reads as distinct blocks without a second logger. Tune it independently via
`log.test` in config (e.g. quiet the build noise, keep the check results), or a `--log` at test time.

### Phase, and configuring it

`phase` is **emitted per call** by the producer. `config.json` may *influence the display* of phases
— most usefully an optional `log.phases` to **mute or re-level** a noisy phase (e.g. silence
`assets` chatter, or force `templates` to `verbose`). Treat this as **advanced / defer it**: ship
level + colour + file first; add phase-level controls only if a real need appears, so the common
case stays a single `level`.

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
3. Add config resolution: read `config.json` `log` (+ `log.<command>`), then apply env, then the
   CLI flags (`--quiet` / `--verbose` / `--no-color` / `--log …`) — the order in
   [Configuration](#configuration-configjson--flags).
4. Route `ssg test` (`ok`/`FAIL`, `N passed/M failed`) and the admin server through the same module.
5. Add the file sink (`log.file`) — un-coloured `text`; leave `json` until a CI need lands.
6. Optionally expose a scoped logger to build scripts (see below).

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
- **Scope discipline.** Config is in scope, but keep the `log` block **small and optional** — a
  level, a colour policy, an optional file sink. Resist a general logging framework (transports,
  arbitrary sinks, pluggable formatters). Builds are sub-second; favour a ~100-line module over
  cleverness. The `json` file format is the *one* sanctioned structured output — build it when a real
  CI need lands, not before.
- **Config/flag drift.** Two places to set the same thing (config + flags) can confuse — keep the
  field names identical across `config.json`, `--log key=value`, and the record, and document the
  one resolution order so "why is it verbose?" has a single answer.
- **Don't over-tag.** Three severities + a phase + an optional group is enough; more axes make the
  reporter (and the call sites) noisy.

## Decided

- **Module/method names:** `log` — `log.success/info/warn/error/debug`.
- **Grouping:** by `level` (severity) + `phase`.
- **Phase:** passed per call; `config.json` may optionally re-level/mute phases (deferred).
- **`ssg test`:** shares the one logger instance, separated by `phase` tag + tunable via `log.test`.
- **Config + flags:** both, layered (defaults → `config.json` `log[.command]` → env → CLI), all
  optional. A single top-level `log` object with optional `build`/`test` overrides; a `file` sink for
  the CI/persistent case.

## Open questions

- CLI flag spelling for the general override: `--log key=value,…` vs discrete `--log-level` /
  `--log-file` / `--log-color` (keep `--quiet`/`--verbose`/`--no-color` either way).
- `log.phases` (per-phase mute/re-level) — needed in v1, or deferred until something is too noisy?
- `json` file format — define the record schema now (so it's stable) or when the first CI consumer
  appears?
- Log-file lifecycle: truncate per build vs append; relative-to-site path; should `build/` ever hold
  it (no — it's wiped each build), so default somewhere like the site root or a `logs/` dir.
