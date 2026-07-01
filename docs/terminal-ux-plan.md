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

**The record.** Each call appends a structured record, not a string — and that record *is* the
`jsonl` line (one shape, rendered two ways: pretty for the console, verbatim for the file). The
schema (decided):

```jsonc
{
  "timestamp": "2026-06-30T14:22:05.123Z",  // UTC, ISO 8601 + ms — exactly Node's Date.toISOString()
  "phase":     "collections",               // build | test | collections | templates | assets | … (extensible)
  "level":     "WARNING",                   // SUCCESS | INFO | WARNING | ERROR | DEBUG (+ extensible)
  "logger":    "component",                 // coarse origin (subsystem) — see below
  "message":   "no `copy` — files will not ship",
  "metadata":  { "source": "carousel.build.js",   // fine origin (file/name)
                 "group":  "products",
                 "hint":   "set copy:true to ship or copy:false to silence",
                 "count":  1 }              // metadata is fully open — any producer extras
}
```

- **Grouping is by `level` + `phase`** (decided). `metadata.group` is the optional finer grouping key
  (a collection/component name); `metadata.hint` is the action text; `metadata.count` collapses
  repeats (generalising `flushDeferredWarnings`). **`metadata` is fully open** — no reserved keys;
  the console renderer just *looks for* the well-known ones (`source`/`group`/`hint`/`count`) and
  ignores the rest, while `jsonl` keeps everything.
- **`phase` is passed per call** — the producer knows its phase; the logger tracks no hidden
  "current phase".
- **Provenance is two-level (decided):** **`logger`** is the **coarse** origin — the subsystem
  (`engine`/`build`, `component`, `generator`, `page`, `test`, …) — and **`metadata.source`** is the
  **fine** one (the actual file/name: `carousel.build.js`, `generate-guides.js`, a check's name).
  Both are mostly **auto-filled**: the scoped logger handed to a build script/generator pre-binds
  `logger` + `metadata.source` (and usually `phase`), so a component just calls
  `log.warn(msg, { hint })`. `phase` = *when*, `logger`/`source` = *who*.
- **Casing/levels (decided):** the key is lowercase **`logger`**; `level` **values** are UPPERCASE and
  the set is `SUCCESS | INFO | WARNING | ERROR | DEBUG` (`DEBUG` is the verbose-only tier).

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
| `quiet` | ERROR + the final summary (+ timings) |
| `normal` (default) | phase headers, SUCCESS, WARNING, ERROR, summary, **timings** — no per-item lines |
| `verbose` | + INFO (per-item lines) + DEBUG + resolved paths |

- **Timings show at every level** (decided) — the summary's total elapsed always, phase durations
  from `normal` up; only *per-item* timing is `verbose`.
- **The mapping is a single editable table** (decided): a `{ renderCategory → minLevel }` map in
  `lib/log.js` (e.g. `error: quiet`, `summary: quiet`, `timing: quiet`, `phaseHeader: normal`,
  `success: normal`, `warning: normal`, `perItem: verbose`, `debug: verbose`). Change the mapping in
  one place, not scattered `if (level === …)` conditionals.
- Plus a colour policy (`auto` / `always` / `never`, handled in `lib/colors.js`). The logger stores
  the resolved level; a call below its category's threshold is recorded (for the `jsonl` file) but
  not printed to the console.

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
file sink.** "Always tee a full/`jsonl` log to `log/`" is something you want committed and not
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

### The file sink

**Opt-in** (off by default, so the zero-config build stays clean). When enabled it writes a fresh
**per-run** file:

```jsonc
"file": true                                            // on, with all defaults
"file": { "level": "verbose", "format": "text" }        // on, tuned
"file": { "dir": "log", "format": "jsonl",              // change folder / format
          "retention": { "maxFiles": 50, "maxAgeDays": 30 } }
```

- **Default location: a `log/` folder at the site root, named `<datetime>.<ext>`** — one file per
  build, so there's no truncate-vs-append question and runs don't clobber each other. Folder/filename
  configurable (`dir` / `path`) in `config.json` or via `--log file=…`.
- **Filename = compact UTC timestamp + pid** (decided): `<YYYYMMDDThhmmsssssZ>-<pid>.<ext>`, e.g.
  `20260630T142205123Z-04812.jsonl`. The stamp is `Date.toISOString()` with separators stripped
  (`.replace(/[-:.]/g,'')`) — colon-free (Windows-safe) and name-sorts chronologically; the
  `process.pid` suffix de-collides two runs that start in the same millisecond (e.g. parallel CI).
- The file is **always un-coloured** (ANSI stripped) and may run at a **higher level than the
  console** — e.g. console `normal` (summary only on screen) while the file captures `verbose`.
- **`log/` is a build artifact → gitignored** (added to the engine `.gitignore`; sites that adopt
  the file sink add it too). Don't put it *inside* `build/`, which is wiped each run.

**Retention (decided: configurable deletion).** Off unless set — never delete a user's files
silently. When `retention` is present, prune the `log/` dir on each run:

```jsonc
"retention": { "maxFiles": 50, "maxAgeDays": 30 }   // delete oldest beyond 50, and/or older than 30 days
```

- Either rule alone, or both (delete a file that violates *either*). `maxFiles` keeps the newest N;
  `maxAgeDays` drops anything older than N days.
- **Safety: only ever delete files matching the engine's own name pattern**
  (`^\d{8}T\d{9}Z\.(log|jsonl)$`) — a stray file a user dropped in `log/` is never touched.
- **When:** prune at **startup**, before opening the new run's file (so a crash never skips the next
  prune, and the just-written file isn't a candidate). Deletion is destructive, so keep it
  conservative: own-pattern only, opt-in, log what it removed at `debug`.

### File durability + the JSON question (your crash concern)

Your worry is right *for one specific shape*: a log that **assembles one big JSON array/object and
writes it at the end** loses everything if the process dies mid-build. The fix is to **not** use that
shape.

- **Stream the file, append-per-record.** Open the sink at startup and write each record the moment
  it's logged — never buffer the file. A crash then leaves a **valid partial log** of everything up to
  the failure. (The console reporter is the *only* buffered consumer — it holds records to group them
  for readability; the file does not.) So architecturally the logger **fans each record out to
  sinks**: console = buffer + group (pretty), file = append-stream (durable), and errors also echo to
  the console live. Enabling a file sink is itself the mitigation for "lost output on a crash."
- **For `format: "json"`, use JSON Lines (JSONL / NDJSON): one JSON object per line**, appended as
  each record is emitted — *not* a single enclosing array. Each complete line is independently valid,
  so JSONL keeps the streaming durability of the text sink while staying machine-readable. (A strict
  single-array `.json` is the fragile form to avoid.) A final `summary` record can be the last line.
- Net: text and `jsonl` sinks share the same append-per-record path and differ only in how a record
  is rendered (human line vs JSON object). The file is **chronological** (good for reconstructing a
  crash), while the console stays **grouped**.
- Honest scoping: for a sub-second build, abrupt crashes are rare — but JSONL makes durability free,
  so there's no reason to choose the fragile shape. Still, defer actually *building* the `jsonl`
  format until a real CI consumer exists; just reserve the format name and the JSONL decision now.

### Resolution order (low → high)

1. **built-in defaults** (`normal`, `auto`, no file)
2. **`config.json` `log.*`** (shared)
3. **`config.json` `log.<command>.*`** (`build` / `test`)
4. **environment** — `NO_COLOR` / `FORCE_COLOR` (the de-facto standards) for the colour axis
5. **CLI flags** — highest, this run only

### The command-line override

**Decided: a general `--log key=value` flag**, where **multiple pairs** are accepted — both
**repeated** and **comma-joined**:

```bash
ssg build --log level=verbose --log file=true        # repeated
ssg build --log level=verbose,color=never            # comma-joined in one flag
ssg build --log file=true,format=jsonl
```

Each pair maps to a `log.*` field (`level`, `color`, `file`, `format`, `dir`, …) and sets the **top
layer** of the resolution above (this run only). Keep the ergonomic shortcuts **`--quiet` /
`--verbose` / `--no-color`** as aliases (`--quiet` ≡ `--log level=quiet`). Parsing is trivial: split
repeats, split on `,`, split each on the first `=`; an unknown key is a friendly error, not a crash.

> Boolean-ish values: `file=true`/`file=false` toggles the default-path sink; `file=<path>` sets an
> explicit path. Keep the value grammar small (strings, `true`/`false`) — no nested objects on the
> CLI; reach for `config.json` when it gets richer.

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
5. Add the file sink (`log.file`) — append-streamed, un-coloured `text` to `log/<datetime>.log`;
   leave `jsonl` until a CI need lands.
6. Optionally expose a scoped logger to build scripts (see below).

**Keep message text stable** during the move so the test suite keeps matching (see caveats).

## Notes on the other Tooling & Distribution tasks

- **Slim core / deploy (task 1).** `lib/log.js` stays in the **core**, never deployed — it's
  machinery, not content. Good litmus test for "what is core": the build can't narrate itself
  without it.
- **Plugins / build scripts (task 3).** Extend the build-script helpers (4th arg) with a **scoped
  logger** — e.g. `helpers.warn(msg, { hint })` that **pre-binds `logger: "<component>.build.js"`**
  (and the current `phase`) so the record's provenance fills itself in. A material then reports
  *through* the system (attributed + grouped) instead of `console.log` — a sanctioned, well-behaved
  output channel for third-party materials (ties into the trust boundary). Additive and
  backward-compatible: existing scripts that `console.log` still work; migrate the engine's own first.
- **`ssg init` / `add` (task 2).** Because the logger ships **first**, `init`/`add` are built on it
  from day one — their output (scaffold steps, next-step hints, success lines) **must use `log`**, not
  raw `console.log`. They're a good proving ground for `success`/next-step messaging.

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
  cleverness. `jsonl` is the *one* sanctioned structured output — build it when a real CI need lands,
  not before.
- **Config/flag drift.** Two places to set the same thing (config + flags) can confuse — keep the
  field names identical across `config.json`, `--log key=value`, and the record, and document the
  one resolution order so "why is it verbose?" has a single answer.
- **Don't over-tag.** Three severities + a phase + an optional group is enough; more axes make the
  reporter (and the call sites) noisy.

## Decided

- **Module/method names:** `log` — `log.success/info/warn/error/debug`.
- **Grouping:** by `level` (severity) + `phase`.
- **Phase:** passed per call. `log.phases` (per-phase mute/re-level) is **deferred**.
- **`ssg test`:** shares the one logger instance, separated by `phase` tag + tunable via `log.test`.
- **Config + flags:** both, layered (defaults → `config.json` `log[.command]` → env → CLI), all
  optional. A single top-level `log` object with optional `build`/`test` overrides.
- **CLI override:** `--log key=value`, **multiple pairs** (repeated and/or comma-joined); `--quiet`/
  `--verbose`/`--no-color` are aliases.
- **Record schema:** `{ timestamp (UTC ISO+ms), phase, level (UPPERCASE incl. DEBUG), logger,
  message, metadata{…} }` — the in-memory record *is* the `jsonl` line. Provenance is two-level:
  `logger` (coarse subsystem) + `metadata.source` (fine file/name), both auto-filled. `metadata` is
  fully open (no reserved keys).
- **File sink:** opt-in, **per-run file** at `log/<YYYYMMDDThhmmsssssZ>-<pid>.<ext>` (compact UTC +
  pid, configurable `dir`/`path`), un-coloured, **append-streamed per record** (crash-durable).
  `log/` gitignored.
- **JSON format = JSON Lines** (one record per line, streamed) — *not* a single assembled array —
  so it keeps streaming durability. Reserve it now; **build it on first CI need**.
- **Retention:** opt-in `retention: { maxFiles, maxAgeDays }`, pruned at startup, own-name-pattern
  files only. **No default cap** — nothing is deleted unless configured.
- **`ssg init` / `add`:** built on `log` from day one (logger ships first); their output uses `log`.

## Locked before coding (decided)

The data model, config, file sink, and CLI were already settled; these four (rendering + lifecycle)
are now decided too, so the [implementation plan](#implementation-plan-commits) can start.

1. **The CLI command owns the report lifecycle, not `build.js`.** `ssg build` does
   `begin → build() → summary → exit`; `ssg test` does `begin → build() → checks() → tests() →
   summary → exit` — **one report, one summary** across all phases. `build.js` only *logs*; it never
   calls `summary()`/`exit`. **Errors are always emitted in real time** (streamed as they happen, not
   held for the flush); grouped non-error output renders progressively / at the section boundary.
   Grouping is a **bounded-run** feature — the logger also supports plain **streaming** (no end
   flush), which is what the future **watch** task (smart rebuild-on-save for the server) will use;
   the admin server is **not migrated now** — it waits for that task.
2. **Test-suite strategy.** Keep every message's **text byte-identical** — only the chrome (colour,
   grouping, prefixes) and the recording change. Add a **record-capture mode** so tests can assert on
   structured records instead of formatted stdout. Migrate a phase, keep `npm test` green, repeat.
3. **Verbosity mapping** (see [Operating modes](#operating-modes)): `quiet` = ERROR + summary;
   `normal` = phase headers + SUCCESS + WARNING + ERROR + summary; `verbose` = + INFO + DEBUG.
   **Timings show at all levels.** The mapping is a **single editable `{ category → minLevel }`
   table** in `lib/log.js`, not scattered conditionals.
4. **Console format mockup** — produced **with the first prototype** (commit 3 below), so the format
   is agreed against real output before the mass migration.

## Still genuinely open (not blockers)

- `logger` value vocabulary — the exact coarse set (`engine`/`component`/`generator`/`page`/`test`?);
  refine as call sites are migrated.
- Datetime in **local vs UTC** for the *console* summary line (the record/filename are UTC-fixed).
- A `--json` **console** mode (stdout as JSONL) for piping — distinct from the file sink; defer.

## Implementation plan (commits)

The through-line: **`npm test` stays green after every commit.** Each commit is small, reviewable,
and reversible. Land 1–3 first (the module + one wired phase = the format mockup), review the look,
then 4 migrates the rest. Build on a branch (e.g. `feat/log`).

### 1 — `lib/colors.js` (traffic-light primitive)
- Raw-ANSI helpers (`green`/`yellow`/`red`/`dim`/`bold`) behind a `paint(kind, text)`; **no chalk**.
- Enablement decided once: `isTTY` + `NO_COLOR` + `FORCE_COLOR` + a `color: auto|always|never`
  input; disabled ⇒ helpers return the string unchanged.
- Tiny unit test (colour off ⇒ identical string; on ⇒ wrapped). No behaviour change anywhere yet.

### 2 — `lib/log.js` core (record + console sink + summary), unwired
- The **record** (`timestamp/phase/level/logger/message/metadata`) and API
  `log.success/info/warn/error/debug(msg, { phase, logger, ...metadata })`.
- **Report lifecycle**: `log.begin()` … `log.summary()` (owned by the caller). Fan-out to **sinks**;
  console sink only for now. **Errors stream immediately**; other records buffer and render at the
  section boundary / summary. Dedupe→`count`; group by `phase`→`level`.
- The `{ category → minLevel }` **mapping table**; a **record-capture mode** (`log.records()`), and
  `log.errorCount`.
- Unit-tested in isolation (`test/log.test.js`): grouping, dedupe, level filtering, capture, colour
  off. **Not imported by `build.js` yet**, so smoke is untouched.

### 3 — wire ONE phase (`collections`) + agree the console format  ← the mockup
- `ssg build` (in `cli.js`) brackets the run with `log.begin()`/`log.summary()`; the `collections`
  phase of `build.js` logs through `log.*` (fold its `deferWarning` calls in). **Message text stays
  byte-identical.**
- This produces the first real coloured, grouped section + summary — the **format mockup** to sign
  off. Adjust smoke only where it matched *chrome* (it shouldn't; text is stable).

### 4 — migrate the remaining phases
- `pages`, `templates`, `assets`, `checks`: convert their `console.*` → `log.*`; retire
  `deferWarning`/`flushDeferredWarnings` and the `buildErrors` counter (exit keys off
  `log.errorCount`). Keep smoke green each phase.

### 5 — config + flag resolution
- Read `config.json` `log` (+ `log.build`/`log.test`), then env (`NO_COLOR`/`FORCE_COLOR`), then CLI
  (`--quiet`/`--verbose`/`--no-color`/`--log key=value`, repeated + comma-joined). Tests for the
  precedence order.

### 6 — `ssg test` through the logger
- `ok`/`FAIL` + `N passed/M failed` via `log.*`; **one report** spanning build → checks → tests with
  a single summary; `log.test` overrides. (Admin/watch still deferred to the watch task.)

### 7 — file sink (text)
- Second sink: append-streamed, un-coloured `text` to `log/<stamp>-<pid>.log` (own level/format);
  `log.file` config + `--log file=…`. **Retention** (`maxFiles`/`maxAgeDays`, startup prune,
  own-pattern only, opt-in).

### 8 — scoped logger for build scripts *(optional, later)*
- `helpers.log` (4th arg) pre-binding `logger` + `metadata.source` + `phase`; migrate the engine's
  own `*.build.js` (e.g. `products.build.js`'s `[PRODUCTS]` lines). Additive; sites adopt when they
  re-sync.

### Deferred (own trigger)
- **`jsonl` file format** — on first real CI consumer.
- **`--json` console mode**, **`log.phases`**, and **admin/watch** logging — with the watch task.

**Release.** This is additive + backward-compatible (no data-model or output-*text* change), so it
can ship as a **minor** (v0.5.0) once phases 1–7 land; 8 and the deferred items follow independently.
