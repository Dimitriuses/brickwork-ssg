# Tooling & distribution — draft plan (for discussion)

> **Status: draft.** Expands the **Tooling & distribution** section of [ROADMAP.md](../ROADMAP.md)
> into per-item detail, proposes sequencing, and records open questions. **Item 4 (terminal UX)
> shipped in v0.5.0–v0.5.1** (both sites migrated); items 1–3 (deploy/slim-core, `ssg init`,
> plugins) remain — a starting point to argue with.

## The pieces (from the roadmap)

1. **Material *deploy* commands & a slim core** — `ssg add component <name>` (and generators/tests)
   scaffolds a material into a site from a catalog, and the engine stops shipping the
   example/default materials every site silently inherits.
2. **`ssg init`** — scaffold a starting project (a baseline set of materials + a minimal
   `config.json`/`pages/`), so a fresh project isn't empty once the core is slim.
3. **npm-distributed third-party plugins/themes + a material registry** — shared distribution once
   the deploy model is proven.
4. **Build/test output overhaul (terminal UX)** — ✅ **done (v0.5.0–v0.5.1):** one output module,
   traffic-light colour, verbosity levels, `config.json`/flags, a file sink, and scoped build-script
   logging. See §4.

Recommended order for what's left: **1 → 2 → 3** (item 4 shipped first, as planned). (1) is the big
structural change and the prerequisite for (2) and (3).

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

## 4. Build/test output overhaul (terminal UX) — ✅ shipped (v0.5.0–v0.5.1)

**Done.** A zero-dependency output system — `lib/log.js` + `lib/colors.js` — that all build/test
output flows through:

- **Traffic-light colour** (🟢 success / 🟡 warning / 🔴 error, dim for narration) with one-time
  TTY + `NO_COLOR`/`FORCE_COLOR` detection; plain/byte-identical when off (piped/CI).
- **Structured records** (`timestamp/phase/level/logger/message/metadata`), warnings deferred +
  de-duplicated, a summary coloured by outcome.
- **Verbosity levels** (`--quiet` / `--verbose`) via a single editable `{ category → minLevel }`
  table (per-item lines are verbose-only), plus a `config.json` `log` block and `--log key=value`
  flags resolved defaults → config → env → CLI.
- **File sink** — opt-in, append-streamed per record (crash-durable), `text` or **`jsonl`**, per-run
  `log/<stamp>-<pid>.<ext>`, own level, with `retention: { maxFiles, maxAgeDays }`.
- **`ssg test`** shares the palette; a **scoped `helpers.log`** gives component build scripts their
  own provenance-tagged logger (so `--quiet` is truly silent). Both sites migrated at v0.5.1.

Full design, decisions, and as-built notes: **[terminal-ux-plan.md](terminal-ux-plan.md)**.

**Remaining (deferred — each waits on its own trigger):**
- **`--json` console mode** — stdout as JSONL for piping, distinct from the file sink. On demand.
- **`log.phases`** — per-phase mute/re-level, when one phase gets too noisy to leave at a single level.
- **admin / watch logging** — route the admin server (and a future *watch* / rebuild-on-save mode)
  through the logger; needs the plain **streaming** path (no bounded-run flush). Lands with the watch
  task.
- **Generator-scoped logger** — extend `helpers.log`'s equivalent to generators (`ctx.log`), so a
  custom generator reports through the system too. When a generator needs to log.

---

## Open cross-cutting questions

- **Colour scope (settled).** Shipped as the three-light scale + dim — no per-phase palettes; a
  verdict at a glance, not a rainbow. Keep it that way.
- **Slim-core timing.** Carving defaults into a catalog (1) is a breaking change for any site that
  relied on inheritance — it pairs with a major version and a migration note, like the v0.4 retire
  of `generate-detail.js`.
- **One distribution story.** (1) in-engine catalog and (3) npm registry should share a single
  `ssg add` resolution path so "where did this material come from" has one answer.
