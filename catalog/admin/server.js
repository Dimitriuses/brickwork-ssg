'use strict';
// Data-model-driven admin server. Reads the site's collections DB (via dirs.database), and for every
// ENABLED collection walks its `data_model` to expose a generic CRUD API — no per-collection code. Part
// types: `object` (a JSON file, read/written whole), `paths` (many files), `file_path` (one file).
// Settings come from the admin config (<dirs.admin>/admin.json, else config.json `admin`): localhost
// binding, port, and per-part upload limits / `hide`. Self-contained: an adopted, site-owned copy runs
// with only its own files + node_modules.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const model = require('./lib/model');
const security = require('./lib/security'); // pure Host/Origin predicates (DNS-rebinding + CSRF)
const fieldTypes = require('./public/fieldTypes'); // lives in public/ so it is also served to the browser

const app = express();

// --- Site + config resolution ------------------------------------------------
// The managed site is the working directory (set by the CLI: `ssg admin --site <dir>`).
const ROOT_DIR = process.cwd();
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }

const siteConfig = readJson(path.join(ROOT_DIR, 'config.json'), {});
const dirs = (siteConfig && typeof siteConfig.dirs === 'object' && siteConfig.dirs) ? siteConfig.dirs : {};
const relOf = (v, def) => (typeof v === 'string' && v.trim()) ? v.trim() : def;
const DATABASE_PATH = path.join(ROOT_DIR, relOf(dirs.database, 'shared/database.json'));
const ADMIN_DIR = path.join(ROOT_DIR, relOf(dirs.admin, 'shared/admin'));

// Admin settings: the admin's own admin.json wins (so the admin can be isolated), else config.json.admin.
const adminConfig = readJson(path.join(ADMIN_DIR, 'admin.json'), null) || (siteConfig && siteConfig.admin) || {};
const LOCALHOST_ONLY = adminConfig.localhost_only !== false; // secure by default
const PORT = adminConfig.port || 3000;
const COLLECTIONS_CFG = (adminConfig && typeof adminConfig.collections === 'object' && adminConfig.collections) ? adminConfig.collections : {};

// --- Path-traversal hardening ------------------------------------------------
// :collection/:id/:part/:filename come from the URL or body and flow into fs calls, so every untrusted
// segment is validated and every resolved path is asserted to stay inside its collection directory.
function badRequest(message) { const e = new Error(message); e.status = 400; return e; }
function notFound(message) { const e = new Error(message); e.status = 404; return e; }
function isSafeSegment(s) {
  return typeof s === 'string' && s.length > 0 &&
    !s.includes('/') && !s.includes('\\') && !s.includes('\0') && s !== '.' && s !== '..';
}
function safeSeg(s, label) { if (!isSafeSegment(s)) throw badRequest(`Invalid ${label || 'path segment'}`); return s; }
function resolveWithin(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) throw badRequest('Resolved path escapes its collection directory');
  return target;
}

// --- Collection / part accessors ---------------------------------------------
function enabledCollections() { return (readJson(DATABASE_PATH, { collections: [] }).collections || []).filter(c => c && c.enabled); }
function getCollection(name) {
  const c = enabledCollections().find(c => c.name === name);
  if (!c) throw notFound(`Collection "${name}" not found (or not enabled)`);
  return c;
}
function collectionSourceDir(c) { return path.join(ROOT_DIR, c.source); }
function itemDirOf(c, id) { return resolveWithin(collectionSourceDir(c), safeSeg(id, 'item id')); }
function listItemFolders(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();
}
function partOf(c, name) {
  const p = model.modelParts(c).find(p => p.name === name);
  if (!p) throw badRequest(`Unknown part "${name}" for collection "${c.name}"`);
  return p;
}
function partConfig(collName, partName) {
  const c = COLLECTIONS_CFG[collName];
  return (c && typeof c[partName] === 'object' && c[partName]) ? c[partName] : {};
}
// Parts shown in the admin — everything unless the part config marks `hide: true`.
function visibleParts(c) { return model.modelParts(c).filter(p => !partConfig(c.name, p.name).hide); }
// The upload-limit subset handed to the client (never leaks `hide`, which is already applied).
function publicPartConfig(collName, partName) {
  const cfg = partConfig(collName, partName);
  const out = {};
  if (cfg.max_count != null) out.max_count = cfg.max_count;
  if (cfg.max_size_mb != null) out.max_size_mb = cfg.max_size_mb;
  if (Array.isArray(cfg.accept)) out.accept = cfg.accept;
  return out;
}
function fileEntry(c, id, filename) { return { name: filename, url: `/files/${encodeURIComponent(c.name)}/${encodeURIComponent(id)}/${encodeURIComponent(filename)}` }; }
function itemTitle(parts, values, id) {
  for (const p of parts) {
    const v = values[p.name];
    if (p.type === 'object' && v && typeof v === 'object') return String(v.name || v.title || id);
  }
  return id;
}
// Validate an object-part value against its `schema` (a no-op when the part declares none). Returns an
// array of human messages ([] when valid).
function objectPartErrors(part, obj) { return part.schema ? fieldTypes.validateObject(obj, part.schema) : []; }

// --- Startup validation: admin.collections must name real collections + parts ------------------------
// A typo/rename in admin.collections (a collection or part that isn't in the DB's data_model) is a
// configuration error, so fail loudly at startup rather than silently ignoring it.
(function validateAdminConfig() {
  const db = readJson(DATABASE_PATH, { collections: [] });
  const byName = new Map((db.collections || []).map(c => [c.name, c]));
  const problems = [];
  for (const collName of Object.keys(COLLECTIONS_CFG)) {
    const c = byName.get(collName);
    if (!c) { problems.push(`admin.collections."${collName}" — no such collection in ${path.relative(ROOT_DIR, DATABASE_PATH)}`); continue; }
    const partNames = new Set(model.modelParts(c).map(p => p.name));
    for (const partName of Object.keys(COLLECTIONS_CFG[collName] || {})) {
      if (!partNames.has(partName)) problems.push(`admin.collections."${collName}"."${partName}" — no such part in the "${collName}" data_model`);
    }
  }
  if (problems.length) {
    console.error('Admin config error:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
})();

// --- Middleware --------------------------------------------------------------
// Browser-mediated defense FIRST (the admin is unauthenticated + edits real source data): reject a
// foreign Host header when bound localhost-only (DNS rebinding), and refuse a cross-site Origin on
// any state-changing request (CSRF). See lib/security.js.
app.use((req, res, next) => {
  if (LOCALHOST_ONLY && !security.hostAllowed(req.headers.host)) {
    return res.status(403).json({ error: 'Forbidden: unexpected Host header (admin is bound to localhost)' });
  }
  if (security.crossOriginBlocked(req.method, req.headers.origin, req.headers.host)) {
    return res.status(403).json({ error: 'Forbidden: cross-origin request refused' });
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve an item's source files (for image previews etc.) straight from the collection source. Scoped
// to a servable (non-`object`) part, so the data file (e.g. product.json) is never served here. The
// filename may be a nested relative path (parts can match nested files) — validated segment-by-segment.
app.get('/files/:collection/:id/:filename', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const filename = security.safeRelPath(req.params.filename);
    if (!filename) throw badRequest('Invalid filename');
    if (!model.filePart(model.modelParts(c), filename)) return res.status(404).end();
    const filePath = resolveWithin(itemDirOf(c, req.params.id), ...filename.split('/'));
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath);
  } catch (e) { res.status(e.status || 400).end(); }
});

// --- API: collections + their (visible) parts --------------------------------
app.get('/api/collections', (req, res) => {
  try {
    res.json(enabledCollections().map(c => ({
      name: c.name,
      label: c.label || c.name,
      parts: visibleParts(c).map(p => ({
        name: p.name, type: p.type, match: p.match, required: p.required,
        schema: p.schema, config: publicPartConfig(c.name, p.name)
      }))
    })));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// --- API: items --------------------------------------------------------------
app.get('/api/collections/:collection/items', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const parts = model.modelParts(c);
    const dir = collectionSourceDir(c);
    res.json(listItemFolders(dir).map(id => ({ id, title: itemTitle(parts, model.readItemParts(path.join(dir, id), parts), id) })));
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/api/collections/:collection/items/:id', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const itemDir = itemDirOf(c, req.params.id);
    if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });
    const out = {};
    for (const p of visibleParts(c)) {
      const matched = model.partFiles(itemDir, p);
      if (p.type === 'object') out[p.name] = matched.length ? model.readJsonSafe(path.join(itemDir, matched[0])) : null;
      else if (p.type === 'paths') out[p.name] = matched.map(f => fileEntry(c, req.params.id, f));
      else out[p.name] = matched.length ? fileEntry(c, req.params.id, matched[0]) : null;
    }
    res.json({ id: req.params.id, parts: out });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Create an item (folder) — id is a slug; optional `parts` seeds object parts.
app.post('/api/collections/:collection/items', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const id = String((req.body && req.body.id) || '');
    if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'Item id must contain only lowercase letters, numbers, and hyphens' });
    const itemDir = itemDirOf(c, id);
    if (fs.existsSync(itemDir)) return res.status(400).json({ error: 'An item with this id already exists' });
    fs.mkdirSync(itemDir, { recursive: true });
    const seed = (req.body && req.body.parts) || {};
    for (const p of model.modelParts(c)) {
      if (p.type === 'object' && seed[p.name] !== undefined) {
        const errs = objectPartErrors(p, seed[p.name]);
        if (errs.length) { fs.rmSync(itemDir, { recursive: true, force: true }); return res.status(400).json({ error: `Validation failed for "${p.name}"`, errors: errs }); }
        const fn = model.objectFileName(itemDir, p);
        if (fn) {
          const target = path.join(itemDir, fn);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, JSON.stringify(seed[p.name], null, 2));
        }
      }
    }
    res.json({ success: true, id });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Write an object part (the JSON body replaces the part's file).
app.put('/api/collections/:collection/items/:id/parts/:part', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const part = partOf(c, req.params.part);
    if (part.type !== 'object') return res.status(400).json({ error: `Part "${part.name}" is not an object part` });
    const itemDir = itemDirOf(c, req.params.id);
    if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });
    const errs = objectPartErrors(part, req.body || {});
    if (errs.length) return res.status(400).json({ error: 'Validation failed', errors: errs });
    const fn = model.objectFileName(itemDir, part);
    if (!fn) return res.status(400).json({ error: `Cannot determine a filename for object part "${part.name}" (match "${part.match}" is a glob)` });
    const target = path.join(itemDir, fn);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(req.body || {}, null, 2));
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.delete('/api/collections/:collection/items/:id', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const itemDir = itemDirOf(c, req.params.id);
    if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });
    fs.rmSync(itemDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// --- API: files (paths / file_path parts) ------------------------------------
// A per-request multer instance carries the part's size limit + accept/glob filter.
function buildUploader(itemDir, part, cfg) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(itemDir, { recursive: true }); cb(null, itemDir); } catch (e) { cb(e); } },
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname || '');
      if (!isSafeSegment(safe)) return cb(badRequest('Invalid filename'));
      if (!part.regex.test(safe)) return cb(badRequest(`Filename does not match part "${part.name}" (${part.match})`));
      if (Array.isArray(cfg.accept) && cfg.accept.length) {
        const ok = cfg.accept.some(ext => safe.toLowerCase().endsWith('.' + String(ext).toLowerCase().replace(/^\./, '')));
        if (!ok) return cb(badRequest(`File type not allowed (accept: ${cfg.accept.join(', ')})`));
      }
      cb(null, safe);
    }
  });
  const limits = {};
  if (cfg.max_size_mb) limits.fileSize = Number(cfg.max_size_mb) * 1024 * 1024;
  return multer({ storage, limits });
}

app.post('/api/collections/:collection/items/:id/parts/:part/files', (req, res) => {
  let c, part, itemDir, cfg;
  try {
    c = getCollection(req.params.collection);
    part = partOf(c, req.params.part);
    if (part.type !== 'paths' && part.type !== 'file_path') return res.status(400).json({ error: `Part "${part.name}" does not hold files` });
    itemDir = itemDirOf(c, req.params.id);
    cfg = partConfig(c.name, part.name);
  } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (!fs.existsSync(itemDir)) return res.status(404).json({ error: 'Item not found' });
  if (part.type === 'paths' && cfg.max_count && model.partFiles(itemDir, part).length >= cfg.max_count) {
    return res.status(400).json({ error: `At most ${cfg.max_count} file(s) allowed for "${part.name}"` });
  }
  buildUploader(itemDir, part, cfg).single('file')(req, res, (err) => {
    if (err) return res.status(err.status || 400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (part.type === 'file_path') { // keep exactly one file: drop any others that matched
      for (const f of model.partFiles(itemDir, part)) if (f !== req.file.filename) { try { fs.unlinkSync(path.join(itemDir, f)); } catch (e) { /* ignore */ } }
    }
    res.json({ success: true, file: fileEntry(c, req.params.id, req.file.filename) });
  });
});

app.delete('/api/collections/:collection/items/:id/parts/:part/files/:filename', (req, res) => {
  try {
    const c = getCollection(req.params.collection);
    const part = partOf(c, req.params.part);
    // Scope the delete to THIS part: never remove an object/data file through a file manager, and only
    // a filename that belongs to the part's glob (so DELETE .../parts/images/files/product.json fails).
    if (part.type === 'object') return res.status(400).json({ error: `Part "${part.name}" does not hold files` });
    const filename = security.safeRelPath(req.params.filename);
    if (!filename) throw badRequest('Invalid filename');
    if (!part.regex.test(filename)) return res.status(400).json({ error: `File "${filename}" does not belong to part "${part.name}" (${part.match})` });
    const filePath = resolveWithin(itemDirOf(c, req.params.id), ...filename.split('/'));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- Start -------------------------------------------------------------------
const HOST = LOCALHOST_ONLY ? '127.0.0.1' : '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('🚀 Admin Panel Started');
  console.log('========================================');
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`📁 Site: ${ROOT_DIR}`);
  console.log(`🗄  Database: ${DATABASE_PATH}`);
  console.log(`🔒 Bind: ${HOST}${LOCALHOST_ONLY ? ' (localhost only)' : ' (ALL interfaces — exposed to the network)'}`);
  console.log('========================================');
  if (!LOCALHOST_ONLY) console.log('⚠  localhost_only is off — this admin is reachable from the network. Ensure you trust it.');
  else console.log('⚠  Unauthenticated — local development only (Host-pinned + cross-origin writes refused).');
  console.log('Press Ctrl+C to stop');
  console.log('');
});
