# Tooling & distribution — draft plan (for discussion)

> **Status: draft.** Expands the **Tooling & distribution** section of [ROADMAP.md](../ROADMAP.md)
> into per-item detail, proposes sequencing, and records open questions. Nothing here is decided —
> it's a starting point to argue with. The four items are largely independent; the **terminal-UX
> overhaul** (incl. colour) is the smallest and can land first.

## The pieces (from the roadmap)

1. **Material *deploy* commands & a slim core** — `ssg add component <name>` (and generators/tests)
   scaffolds a material into a site from a catalog, and the engine stops shipping the
   example/default materials every site silently inherits.
2. **`ssg init`** — scaffold a starting project (a baseline set of materials + a minimal
   `config.json`/`pages/`), so a fresh project isn't empty once the core is slim.
3. **npm-distributed third-party plugins/themes + a material registry** — shared distribution once
   the deploy model is proven.
4. **Build/test output overhaul (terminal UX)** — a broader pass over the CLI's build/test output,
   beyond the v0.4 grouped warnings, **including colour (a traffic-light system)**.

Recommended overall order: **4 → 1 → 2 → 3.** (4) is self-contained and a quick polish win; (1) is
the big structural change and the prerequisite for (2) and (3).

---

## 1. Material deploy commands & a slim core

**Goal.** Turn "drop a same-named file into `components/` to override the engine" into an explicit
**`ssg add <kind> <name>`** that scaffolds a material (component, generator, test, page) into the
site from a **catalog**, *and* shrink the engine so it no longer ships the default/example
materials that every site inherits by site-first resolution.

**The three pains it fixes** (all of which we just hit migrating the two sites):
- **Phantom output.** Example generators/pages an inheriting site never asked for (e.g. the old
  news generator) need an empty-override file to suppress. A slim core ships nothing to suppress.
- **Override = hand-copy.** To edit a component today you dig the file out of `engine/` and copy it
  into the site by hand — exactly what the-home-of-fursuits and brickwork-demo did for every
  component. `ssg add` makes that one command.
- **Silent drift.** An engine update to a shared component can change an inheriting site with no
  diff in the site repo. (CLAUDE.md already calls this out as the shadowing trade-off.)

**Ownership model.** A deployed copy is **owned by the site** — no auto-update. The site's copy is
canonical; engine upgrades never touch it. This is the whole point: it removes the override/sync
problem by making the copy explicit and versioned rather than implicit and shadowed.

**Where the catalog lives.** Two options:
- **(a) In the engine** — a `catalog/` of deployable materials that is *not* part of the build
  (today's `components/` defaults become the catalog, no longer auto-resolved). Simplest; one repo.
- **(b) A separate "materials" project** — sets up (3) naturally, but is more moving parts up front.

Recommendation: start with **(a)** (carve the catalog out of today's defaults), keep the door open
to **(b)** when third-party distribution lands.

**Builds on the material index.** Deploy *by name* needs the registry/index already in the engine
(`components/registry.json`, `generators/registry.json`) to know what is deployable and where its
files go.

**Open questions.**
- What does "slim core" still ship by default? Candidates to keep: `_layout`, the build machinery,
  `lib/`. Everything else (`header`, `footer`, `hero`, `products`/`productCard`, `faq`/`faqItem`,
  `contactIcons`, `carousel`) moves to the catalog.
- Overwrite behaviour: refuse if the target exists, or `--force`? An `ssg add --dry-run`?
- Versioning: record which catalog/engine version a deployed material came from (a small header or
  a `materials.lock`), so an opt-in **`ssg update <name>`** can re-pull and show a diff.
- Dependencies: `ssg add footer` should pull `contactIcons` (footer depends on it) — reuse the
  sub-component/dependency graph the engine already walks for asset bundling.

---

## 2. `ssg init`

**Goal.** Scaffold a working starting project: deploy a baseline set of materials + a minimal
`config.json`, `pages/index/`, `assets/css/global.css`. Once the core is slim (1), a fresh `ssg
build` on an empty dir produces nothing useful — `ssg init` is what makes "new project" pleasant.

**Shape.** `ssg init [dir] [--template <name>]`. A **template** is a named preset (a manifest of
materials + starter pages) — e.g. `blank`, `storefront`. Internally it's just a scripted batch of
the (1) deploy commands plus a few seed files.

**Open questions.** Interactive prompts vs pure flags (keep it non-interactive-friendly for CI)?
What's in the default `blank` template? Does `init` also wire up `package.json` scripts
(`build`/`test`/`admin`) and the engine submodule, or assume the submodule is already added?

---

## 3. npm-distributed plugins/themes + a material registry

**Goal.** Third-party / shared distribution: a community **materials** project or npm packages that
provide components, generators, and **themes** (a theme = a set of CSS-variable overrides, which the
engine already supports via `:root` custom properties). A **material registry** maps a material name
to its source (engine catalog vs an npm package vs a URL), so `ssg add <name>` can resolve beyond
the built-in catalog.

**Depends on (1).** Only worth doing once the deploy/ownership model is proven on the in-engine
catalog.

**Open questions.**
- Package convention (e.g. `brickwork-material-*` / a `brickwork.materials` field in `package.json`).
- **Trust**: a material's `*.build.js` runs arbitrary JS at build time. Installing a third-party
  material = running its code. Document the trust boundary; consider a manifest-only (no-build-script)
  tier for "safe" materials.
- Name resolution order when a name exists in several sources (site > npm > engine catalog?).

---

## 4. Build/test output overhaul (terminal UX) — incl. colour

The most self-contained item, and the one with the clearest payoff. Today's output works but reads
flat.

**Where we are.**
- Bracketed `[TAG]` prefixes that **mix two axes**: *phase* (`[BUILD]`, `[TEMPLATE]`, `[MODEL]`,
  `[PAGES]`, `[COLLECTIONS]`) and *severity* (`[WARNING]`, `[ERROR]`). `ssg test` prints `ok` /
  `FAIL` and an `N passed, M failed` line.
- `console.log` for most lines, `console.error` for errors; **no `console.warn`**.
- v0.4 added `deferWarning` / `flushDeferredWarnings` — warnings are de-duplicated, counted, and
  **flushed grouped at the end** with action text, instead of scattered through the run.
- **No colour anywhere**, and the engine is **zero-runtime-dependency**, so any colour must be raw
  ANSI — *not* chalk.

**Goal.** Output reads as guidance, not noise: a clear severity model, grouped by phase, with a
summary whose colour tells you the outcome at a glance.

### 4a. Colour — the traffic-light system (the headline idea)

A simple, three-colour severity scale, applied consistently across build and test:

| Severity | Colour | Used for |
|---|---|---|
| **success** | 🟢 green | build completed, `N pages built`, all checks `ok`, `N passed` |
| **warning** | 🟡 amber (yellow/orange) | deferred warnings — omitted `copy`/`required`/`type`, missing images, a `map` miss, no-`data_model` collection |
| **error** | 🔴 red | build-failing problems — bad glob, required-but-missing, unknown generator, name collision, broken links, `M failed` |

Plus a **neutral/dim** tone for phase headers and per-item chatter (`[BUILD] foo.html`), so colour
is reserved for things that carry a verdict.

**Implementation (zero-dependency).**
- A tiny `lib/colors.js`: raw ANSI codes (`\x1b[32m` green, `\x1b[33m` yellow, `\x1b[31m` red,
  `\x1b[2m` dim, `\x1b[0m` reset) behind helpers — `green(s)`, `warn(s)`, `error(s)`, `dim(s)` — or
  a single `paint(severity, text)`. **No chalk.**
- **Enablement / detection**, decided once at startup:
  - On when `process.stdout.isTTY` (errors keyed off `stderr.isTTY`).
  - Honour **`NO_COLOR`** (any value ⇒ off — the de-facto standard) and a **`--no-color`** flag.
  - Honour **`FORCE_COLOR`** (force on, e.g. for CI logs that do render ANSI).
  - When disabled, the helpers return the string unchanged — every line goes through them, so plain
    output is identical to today's, just uncoloured.
- **Layering on what exists**: colour the *severity*, keep the *phase* tag dim. The natural seams
  are already there — the `[WARNING]`/`[ERROR]` prefixes, the `flushDeferredWarnings` block, and the
  `ok`/`FAIL`/summary lines in `ssg test`. Route those few sinks through the helpers and most of the
  win lands with little churn.

This colour pass is a good **standalone first commit**: small, no API surface, reversible, and it
makes the existing grouped warnings legible.

### 4b. The rest of the overhaul (beyond colour)

- **Split phase vs severity.** Stop overloading `[TAG]`: a dim phase label (`build`, `template`,
  `checks`) + a coloured severity glyph/word. One format helper so every line is consistent.
- **Per-phase grouping + a verdict summary.** Sections in order (collections → pages → templates →
  checks), then a final summary line **coloured by the worst severity seen**: green "built N pages,
  0 warnings", amber "… N warnings", red "build FAILED: M errors". (We already flush warnings + a
  summary at the end — this formalises it.)
- **Quiet / verbose levels.** `--quiet` (errors + final summary only), default (phase headers +
  grouped warnings + summary), `--verbose` (per-item `[BUILD]` lines, timings). Keeps default output
  scannable without losing detail on demand.
- **Apply to `ssg test` too.** Green `ok` / red `FAIL`, amber for skipped, and a summary coloured by
  outcome — same helpers, same rules.

**Sequencing within (4).** 4a (colour) ships first and alone; 4b (levels, phase/severity split) can
follow incrementally. None of it depends on (1)–(3).

---

## Open cross-cutting questions

- **Colour scope creep.** Keep it to the three-light scale + dim. Resist per-phase palettes; the
  point is a verdict at a glance, not a rainbow.
- **Slim-core timing.** Carving defaults into a catalog (1) is a breaking change for any site that
  relied on inheritance — it pairs with a major version and a migration note, like the v0.4 retire
  of `generate-detail.js`.
- **One distribution story.** (1) in-engine catalog and (3) npm registry should share a single
  `ssg add` resolution path so "where did this material come from" has one answer.
