# Material deploy, slim core & `ssg init` — draft plan (for discussion)

> **Status: decisions locked; ready to build Phase 1.** Combines two roadmap items — **"Material
> *deploy* commands & a slim core"** and **"`ssg init`"** — into **one task, two phases**, bridged by
> a transitional `ssg add --all-used` so the breaking change lands safely. Detail for
> [tooling-and-distribution-plan.md](tooling-and-distribution-plan.md) §1–2. See **Decided** and the
> **Implementation plan (commits)** below.

## The problem

Today the engine **ships default components** (`header`, `footer`, `hero`, `products` +
`productCard`, `faq` + `faqItem`, `contactIcons`, `carousel`, `_layout`) and a site **inherits** any
it doesn't override, via **site-first per-file resolution**. Overriding means **hand-copying** a file
into the site's `components/`.

The **slim core** goal: the engine stops shipping those defaults; materials are **deployed by name**
into a site instead (`ssg add`). That fixes three real pains (phantom example output; override =
dig-and-copy; silent drift on engine update). But it's a **breaking change**: the moment the engine
drops a default, every inheriting site loses that component and the build fails to resolve it.

**Concrete stakes (measured):** the **demo** owns only `carousel` + `testimonials` and **inherits
~8** materials (`header`, `footer`, `hero`, `products`/`productCard`, `faq`/`faqItem`, `contactIcons`,
`_layout`). Under a naive slim core it would break outright. (The **private** site already owns every
component it uses — it copied them all during the v0.4 migration — so it's the "already-ejected" case.)

## Your idea: a transitional "eject" bridge — endorsed

Ship a **bridge release** that *still* includes all defaults **and** adds a command that, when run,
**copies every component a site uses-but-inherits into the site**. After running it a site **owns**
everything, so the *next* release can drop the defaults with **zero breakage**. The command is
obsolete once nothing is inherited, so it can be removed in the slim release.

This is the right shape — it's the "eject" pattern (à la create-react-app), scoped and automated for
one transition. Why it works and what to sharpen:

- **It inverts the risk.** Instead of "remove defaults and hope sites coped," sites take **ownership
  first**, verifiably, while the safety net (the defaults) is still in place. The breaking release
  then only affects sites that ignored the bridge.
- **Reuse the build's own resolution for "used" — don't re-invent it.** The engine already walks the
  component graph (for asset bundling) and already resolves each file **site-first** via
  `resolveComponentFile(name, file)`. Eject = *(used component set)* × *(its files)*, and for every
  file that **resolves to an engine path while the site has no local copy**, copy it to the site.
  That's the ground truth of what the build actually pulls from the engine — no guessing.
- **Per-file gap-fill, never clobber.** Resolution is per-file, so a site may own `header/header.html`
  but inherit `header/header.build.js`. Eject must copy **only the files the site lacks**, preserving
  partial overrides. Idempotent + safe to re-run.
- **Copy whole folders for nested materials.** A component's **nested sub-component folders**
  (`faq/faq_item/…`) and **bundled `style.css`/`script.js`** must come along (the C1/C2 structure),
  or the ejected component is half-copied.
- **Report through the new logger.** Each copied file → `log.info` (phase `eject`); a skipped
  already-owned file → `log.debug`; a component that couldn't be resolved → `log.warn`. `--dry-run`
  prints the plan without writing. (Nice cohesion with the v0.5 terminal-UX work.)
- **It doesn't commit.** It writes files; the site owner reviews + commits. The migration is a normal
  reviewable diff in the site repo.

One honest note: ejecting makes explicit the trade-off that already exists for hand-copied components
— **an owned component stops tracking engine updates.** That's the *point* (ownership), but the
command should say so in its summary.

## Two phases

Illustrative versions: current **v0.5.1** → **Phase 1 = v0.6.0** (additive) → **Phase 2 = v0.7.0**
(breaking, loud migration note). Pre-1.0, so a minor carries the breaking change.

### Phase 1 — deploy commands + the `--all-used` bridge *(defaults still shipped; additive; ~v0.6.0)*

- **`ssg add <name>`** (component by default; `ssg add <kind> <name>` for others) — deploy a single
  material from the engine **catalog** into the site. `--force` to overwrite, `--dry-run` to preview.
  The **permanent** command.
- **`ssg add --all-used`** *(decided name)* — the **transitional bridge**: auto-detect the site's
  used-but-inherited materials (components + `_layout`) and gap-fill them per file. Same copy path as
  single `add`, just over the detected set. `--dry-run`; logger output (phase `add`). Removed in
  Phase 2.
- **"Used" = build resolution** *(decided)*: walk the site's component graph exactly as the build
  does — page `components` arrays + `{{COMPONENT:…}}` + declared `subComponents` + dependencies +
  the always-on `header`/`footer`/`_layout` — then, per file, check whether it **resolves to the
  engine while the site lacks a local copy** → copy it.
- The engine is otherwise **unchanged** (still ships every default) → opt-in and safe. Validate on
  the **demo** (`--all-used` → owns all 8 inherited → builds identically) and confirm the **private**
  site's run is a near-no-op (it already owns everything).

### Phase 2 — slim core + `ssg init` *(defaults removed; breaking; ~v0.7.0)*

- **Slim core.** Default materials move from the auto-resolved `components/` to an in-engine
  **`catalog/`** *(decided)* — shipped but **not** resolved during a build. The **core keeps the
  generation tools** (build pipeline, data model, template/`map` rendering, component resolution, the
  log system); the catalog holds **optional materials**. Using any is opt-in — themed / design-system
  variants are an **option, not a requirement** (they belong to the Phase-3 registry, below).
- Build resolution for a name the site doesn't own → a **clear "not installed — run `ssg add <name>`"
  error**, not a silent miss. `ssg add` now pulls from the catalog (its permanent home). Remove
  **`ssg add --all-used`** (nothing left to eject).
- **`_layout` is deployable too** *(decided)* — it lives in the catalog **as a component** (recommended
  over inventing a "page" material kind: it already resolves as a component and lives in
  `components/_layout/`). `ssg init` always installs it; existing sites get it via `--all-used`.
- **`ssg init [dir]`** — scaffold a **blank** project from scratch *(decided)*: `package.json`,
  `config.json`, `assets/css/global.css`, `assets/js/global.js`, `pages/index/index.{html,json}`
  (a welcome page), and `components/_layout/_layout.html`. **`ssg init --template demo`** copies the
  **demo** project from its repository.
- **Migration note (loud):** "v0.7 removes bundled defaults; on v0.6 run `ssg add --all-used` (or
  `ssg add` each material) so your site owns them first." The bump is gated on that.

## Notes & suggestions

- **One copy path.** `ssg add --all-used` = "for each used-inherited material, do what `ssg add`
  does, per missing file." Build `ssg add <name>` as the primitive; `--all-used` orchestrates it over
  the detected set. Same code, one behaviour to test.
- **The catalog is the current `components/`, relocated.** Minimal work: move `engine/components/*`
  → `engine/catalog/*` and stop resolving builds from it. Keep it **build-tested** — the bundled
  `example/` site should deploy + exercise the catalog so it can't rot (a catalog that nobody builds
  silently breaks). `_layout` moves into the catalog too (deployable component).
- **Generators need nothing now.** The engine ships **no** default generators (`registry.json` is
  `{}`), so slim core is a *components*-only concern today. Keep `ssg add generator <name>` in the
  design for symmetry, but there's no generator inheritance to `--all-used`.
- **`ssg init` = a real blank project.** Not "copy a baseline set of catalog materials" — literally
  emit the files a working site needs: `package.json` (with `build`/`test`/`admin` scripts + the
  engine submodule reference), `config.json`, `assets/css/global.css` + `assets/js/global.js`,
  `pages/index/index.{html,json}` (a welcome page), and `components/_layout/_layout.html`. So a fresh
  `ssg init && npm run build` produces a page with no other materials needed. `--template demo` is the
  richer path — a copy of the demo repo.
- **Provenance stamp → the material's `.json`, but deferred with the registry.** Decided location:
  record the source (e.g. engine version) in the copied material's `<name>.json`. But it's only
  *useful* alongside the tooling that reads it (e.g. "list the site's materials + where they came
  from"), so both the stamp and its display move to **tooling draft §3 (plugins + material
  registry)**. `ssg add`/`--all-used` stay plain copies for now. (Wrinkle to settle there: materials
  with no `.json` — a template-only component, or a `.js` generator — need a stamp home too.)

## Caveats / watch-items

- **"Used" false negatives are the sharp edge.** If eject misses a component the site actually needs
  (e.g. referenced only dynamically, or via an unusual `registry.json` remap), slim core breaks that
  site. Mitigation: drive "used" from the **actual build resolution** (ground truth), and **warn
  loudly** on anything ambiguous rather than silently skipping. A good acceptance test: *after eject,
  a build with the engine's `components/` temporarily emptied still succeeds.*
- **Partial overrides must survive.** Gap-fill per file; never overwrite a site's existing file.
- **`components/registry.json` remaps.** If a site maps a name to a non-default folder, eject/add
  must respect the mapping when deciding source + destination paths.
- **Slim core is breaking — treat it like the `generate-detail.js` retire (v0.4).** Major-ish bump,
  loud migration note, and *the sites go first* (eject demo + verify private) before the engine drops
  anything.
- **Catalog rot.** Once defaults aren't auto-built, they can break unnoticed. The example site (or a
  dedicated catalog smoke) must deploy + build them every CI run.
- **Idempotency + git hygiene.** Eject/add write only; re-running is safe; the tool never commits.
- **Scope creep into a package manager.** `ssg add`/`eject` copy *local* engine materials by name.
  **Third-party/npm distribution + a registry is a later item** (tooling draft §3) — keep this task
  to the in-engine catalog so it stays small.

## Decided

- **Bridge command:** **`ssg add --all-used`** — a flag on the permanent `ssg add`, not a separate verb.
- **"Used" detection:** **build resolution** — the site's actual component graph, per file, site-first.
- **Scope:** **components + `_layout`** (the engine ships no default generators, so nothing else).
- **`_layout`:** a **deployable catalog component** (not kept in core; not a new "page" material kind).
- **Catalog:** **in-engine `catalog/`**; the core keeps the generation tools, the catalog holds
  optional materials + (later) themed variants.
- **`ssg init`:** emit a **blank** project (`package.json`, `config.json`, `global.css`/`global.js`,
  `pages/index` welcome page, `components/_layout`); **`--template demo`** copies the demo repo.
- **Provenance stamp:** in the material's `.json`, but **deferred to §3** (registry) with its display.
- **Phase 2 removes `--all-used`** (its job is done).

## Residual open (small)

- **Drift detection.** `--all-used` strictly gap-fills; should it *also* flag an already-owned file
  that has drifted from the engine's current version (informational only), or stay silent?
- **`--template demo` mechanism.** `git clone` the demo repo at init time (needs network, always
  current) vs bundle a demo snapshot in the engine (offline, can go stale). Lean **git clone**, with a
  helpful error when offline.
- **A used name the engine never had** (a purely site-authored component) — `--all-used` skips it
  silently (already owned); confirm that's the wanted behaviour.

## Implementation plan (commits)

`npm test` green after each. **Phase 1** is the actionable near-term work; **Phase 2** is a
coordinated breaking release, done *after* Phase 1 ships and the sites have run `--all-used`.

### Phase 1 — `ssg add` + `--all-used` (~v0.6.0, additive)

1. **`lib/deploy.js` — the copy primitive.** `materialFiles(name)` (a component's engine files:
   `<name>.html`, `<name>.build.js`, `<name>.json`, `style.css`, `script.js`, + nested sub-component
   folders, honouring `registry.json` folder maps) and `deployMaterial(name, { siteRoot, force,
   dryRun })` → per-file copy engine→site, skip existing unless `force`, return `{ copied, skipped }`.
   Unit-tested against a temp site. No CLI yet.
2. **`ssg add <name>` CLI.** New `add` command in `cli.js`: `configureLogging('add')`, deploy the
   named material via `lib/deploy`, `--force`/`--dry-run`, logger summary ("added N file(s)"); a name
   with no engine material → clear error. Tests: adds a component into a temp site; `--dry-run` writes
   nothing; `--force` overwrites.
3. **`lib/used-materials.js` — used-inherited detection.** Extract/reuse the build's component-graph
   walk (page `components` + `{{COMPONENT}}` + `subComponents` + deps + `header`/`footer`/`_layout`)
   to compute the used set, then per file mark those that **resolve to the engine while the site
   lacks a copy**. Unit-tested on a fixture site that references + inherits a couple of components.
4. **`ssg add --all-used`.** Orchestrate detection → `deployMaterial` per missing file → one summary;
   `--dry-run`. Acceptance test: after `--all-used` on the fixture, a build with the engine's
   `components/` temporarily hidden **still succeeds** (proves completeness); owned files untouched.
5. **Docs + README.** Document the `add` commands; mark Phase 1 done here + in the tooling draft §1
   and ROADMAP. (Running `--all-used` on the real demo happens in the *sites* when they bump to v0.6.)

### Phase 2 — slim core + `ssg init` (~v0.7.0, breaking — after sites eject)

A. **Relocate defaults to `catalog/`.** Move `engine/components/*` (incl. `_layout`) →
   `engine/catalog/*`; point `add`/`--all-used` at the catalog; stop build resolution from the (now
   empty) engine `components/`. Make the bundled `example/` site `ssg add` its materials so it still
   builds and the catalog stays CI-tested.
B. **Not-installed error.** Resolution for an unowned name → a clear "not installed — run
   `ssg add <name>`" error (instead of a silent miss).
C. **`ssg init`.** The blank scaffold (files above) + `--template demo` (clone the demo repo).
D. **Remove `--all-used`** (+ its detection lib if unused elsewhere); loud migration note; the bump.
   Ship engine + both sites together (sites already own their materials from Phase 1).
