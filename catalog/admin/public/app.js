'use strict';
// Data-model-driven admin UI. Everything is generated from GET /api/collections (collections + their
// visible parts, each with type/schema/limits) — no per-collection code. Object parts render a form via
// the shared FieldTypes registry (or a raw-JSON editor when a part has no schema); paths/file_path parts
// render a file manager honouring the part's upload limits.

const FT = window.FieldTypes;
const enc = encodeURIComponent;
const $ = (s, r = document) => r.querySelector(s);
function el(tag, attrs, html) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) e.setAttribute(k, attrs[k]);
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) { return FT.esc(s); }
function isImage(name) { return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name); }
function slugify(s) { return String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function errMsg(e) { return (e && e.message ? e.message : 'Error') + (e && e.errors && e.errors.length ? ': ' + e.errors.join('; ') : ''); }

let toastTimer;
function toast(msg, isErr) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ''; }, 3000);
}

async function api(method, url, body, isForm) {
  const opts = { method };
  if (isForm) opts.body = body;
  else if (body !== undefined) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw Object.assign(new Error(data.error || ('HTTP ' + res.status)), { errors: data.errors });
  return data;
}

const state = { collections: [], current: null, editingId: null };
const collection = (name) => state.collections.find(c => c.name === name);
const partByName = (name) => collection(state.current).parts.find(p => p.name === name);

async function init() {
  try { state.collections = await api('GET', '/api/collections'); }
  catch (e) { toast(errMsg(e), true); return; }
  renderSidebar();
  if (state.collections.length) selectCollection(state.collections[0].name);
  else {
    $('#collTitle').textContent = 'No collections';
    $('#itemsWrap').innerHTML = '<div class="empty">No enabled collections. Enable one in <code>database.json</code> (with a <code>data_model</code>).</div>';
  }
  $('#newBtn').onclick = () => openEditor(null);
  $('#refreshBtn').onclick = () => loadItems();
  $('#backBtn').onclick = () => { showList(); loadItems(); };
  $('#saveBtn').onclick = () => save();
  $('#deleteBtn').onclick = () => state.editingId && removeItem(state.editingId, state.editingId);
}

function renderSidebar() {
  const nav = $('#collections'); nav.innerHTML = '';
  state.collections.forEach(c => {
    const a = el('a', c.name === state.current ? { class: 'active' } : {}, esc(c.label || c.name));
    a.onclick = () => selectCollection(c.name);
    nav.appendChild(a);
  });
}

async function selectCollection(name) {
  state.current = name; renderSidebar();
  const c = collection(name);
  $('#collTitle').textContent = c.label || c.name;
  $('#collMeta').textContent = c.parts.map(p => `${p.name} (${p.type})`).join(' · ');
  showList();
  await loadItems();
}

function showList() { $('#listView').hidden = false; $('#editView').hidden = true; }
function showEdit() { $('#listView').hidden = true; $('#editView').hidden = false; }

async function loadItems() {
  let items;
  try { items = await api('GET', `/api/collections/${enc(state.current)}/items`); }
  catch (e) { toast(errMsg(e), true); return; }
  $('#itemCount').textContent = `${items.length} item(s)`;
  const wrap = $('#itemsWrap');
  if (!items.length) { wrap.innerHTML = '<div class="empty">No items yet. Click <strong>+ New</strong> to create one.</div>'; return; }
  wrap.innerHTML = '';
  const table = el('table', { class: 'items' });
  table.innerHTML = '<thead><tr><th>ID</th><th>Title</th><th></th></tr></thead>';
  const tb = el('tbody');
  items.forEach(it => {
    const tr = el('tr');
    tr.appendChild(el('td', {}, esc(it.id)));
    tr.appendChild(el('td', {}, esc(it.title)));
    const actions = el('td', { class: 'actions' });
    const edit = el('button', { class: 'btn small' }, 'Edit'); edit.onclick = () => openEditor(it.id);
    const del = el('button', { class: 'btn small danger' }, 'Delete'); del.onclick = () => removeItem(it.id, it.title);
    actions.append(edit, del); tr.appendChild(actions);
    tb.appendChild(tr);
  });
  table.appendChild(tb); wrap.appendChild(table);
}

async function openEditor(id) {
  state.editingId = id; showEdit();
  const c = collection(state.current);
  $('#editTitle').textContent = id ? `Edit ${id}` : `New ${c.label || c.name}`;
  $('#deleteBtn').hidden = !id;
  const body = $('#editBody'); body.innerHTML = '';

  let values = {};
  if (id) {
    try { values = (await api('GET', `/api/collections/${enc(state.current)}/items/${enc(id)}`)).parts; }
    catch (e) { toast(errMsg(e), true); return; }
  } else {
    const box = el('div', { class: 'part' });
    box.innerHTML = '<h4>Item ID <span class="badge">slug</span></h4>' +
      '<div class="field"><div class="row"><input id="newId" placeholder="my-item-slug" pattern="[a-z0-9-]+">' +
      '<button class="btn" type="button" id="slugBtn">Slug from title</button></div>' +
      '<small class="muted">lowercase letters, numbers, and hyphens</small></div>';
    body.appendChild(box);
    box.querySelector('#slugBtn').onclick = () => {
      const src = body.querySelector('[name="name"], [name="title"]');
      if (src && src.value) $('#newId').value = slugify(src.value);
    };
  }

  c.parts.forEach(p => body.appendChild(renderPart(p, values[p.name], id)));
}

function renderPart(p, value, itemId) {
  const card = el('section', { class: 'part' });
  card.appendChild(el('h4', {}, `${esc(p.name)} <span class="badge">${esc(p.type)}</span>`));
  card.appendChild(p.type === 'object' ? renderObjectForm(p, value || {}) : renderFileManager(p, value, itemId));
  return card;
}

function renderObjectForm(p, obj) {
  const form = el('form', { class: 'obj-form', 'data-part': p.name });
  form.onsubmit = (e) => e.preventDefault();
  const schema = p.schema && Object.keys(p.schema).length ? p.schema : null;
  if (schema) {
    for (const [name, field] of Object.entries(schema)) {
      const t = FT.typeOf(field);
      const f = el('div', { class: 'field' });
      f.innerHTML = `<label>${esc(field.label || name)}${field.required ? ' <span class="req">*</span>' : ''}</label>`;
      f.insertAdjacentHTML('beforeend', t.input(name, t.serialize(obj[name]), field));
      form.appendChild(f);
    }
  } else {
    form.dataset.json = '1';
    form.appendChild(el('div', { class: 'muted small' }, 'No schema — editing raw JSON.'));
    const ta = el('textarea', { class: 'json', rows: '10' });
    ta.value = JSON.stringify(obj || {}, null, 2);
    form.appendChild(ta);
  }
  return form;
}

// Read an object-part form back into a value (throws on invalid raw JSON).
function readObjectForm(form, part) {
  if (form.dataset.json) {
    const raw = form.querySelector('textarea').value.trim() || '{}';
    try { return JSON.parse(raw); } catch (e) { throw new Error(`${part.name}: invalid JSON — ${e.message}`); }
  }
  const obj = {};
  for (const [name, field] of Object.entries(part.schema)) {
    const t = FT.typeOf(field);
    const input = form.querySelector(`[name="${name.replace(/"/g, '\\"')}"]`);
    const rawVal = input ? (input.type === 'checkbox' ? input.checked : input.value) : '';
    obj[name] = t.parse(rawVal);
  }
  return obj;
}

function renderFileManager(p, value, itemId) {
  const wrap = el('div', { class: 'files' });
  if (!itemId) { wrap.appendChild(el('div', { class: 'muted small' }, 'Save the item first, then add files here.')); return wrap; }
  const files = p.type === 'paths' ? (value || []) : (value ? [value] : []);
  if (files.length) {
    const grid = el('div', { class: 'file-grid' });
    files.forEach(f => {
      const cell = el('div', { class: 'file-cell' });
      cell.appendChild(isImage(f.name) ? el('img', { src: f.url, alt: f.name }) : el('div', { class: 'file-icon' }, esc(f.name)));
      const del = el('button', { class: 'btn small danger' }, '✕');
      del.onclick = () => removeFile(p, itemId, f.name);
      cell.appendChild(del);
      cell.appendChild(el('div', { class: 'file-name small' }, esc(f.name)));
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
  }
  const cfg = p.config || {};
  const atMax = p.type === 'paths' && cfg.max_count && files.length >= cfg.max_count;
  const up = el('div', { class: 'upload' });
  if (atMax) {
    up.appendChild(el('div', { class: 'muted small' }, `Max ${cfg.max_count} file(s) reached — remove one to add more.`));
  } else {
    const input = el('input', { type: 'file' });
    if (p.type === 'paths') input.multiple = true; // select several files at once
    if (Array.isArray(cfg.accept) && cfg.accept.length) input.accept = cfg.accept.map(x => '.' + String(x).replace(/^\./, '')).join(',');
    input.onchange = () => input.files.length && uploadFiles(p, itemId, Array.from(input.files));
    up.appendChild(input);
    const remaining = (p.type === 'paths' && cfg.max_count) ? cfg.max_count - files.length : null;
    const hint = [
      p.type === 'paths' ? 'select one or more' : (files.length ? 'replaces the current file' : ''),
      remaining != null ? `${remaining} slot(s) left` : '',
      cfg.max_size_mb ? `up to ${cfg.max_size_mb} MB each` : '',
      Array.isArray(cfg.accept) ? cfg.accept.join('/') : ''
    ].filter(Boolean).join(' · ');
    if (hint) up.appendChild(el('span', { class: 'muted small' }, hint));
  }
  wrap.appendChild(up);
  return wrap;
}

// Upload one or more files to a part (sequential; each hit enforces the part's limits server-side).
// Failures (e.g. a rejected type or hitting max_count) are collected so the rest still go through.
async function uploadFiles(p, itemId, files) {
  let ok = 0; const errs = [];
  for (const file of files) {
    try {
      const fd = new FormData(); fd.append('file', file);
      await api('POST', `/api/collections/${enc(state.current)}/items/${enc(itemId)}/parts/${enc(p.name)}/files`, fd, true);
      ok++;
    } catch (e) { errs.push(`${file.name}: ${errMsg(e)}`); }
  }
  await openEditor(itemId);
  toast(errs.length ? `Uploaded ${ok}, ${errs.length} failed — ${errs[0]}` : `Uploaded ${ok} file(s)`, errs.length > 0);
}

async function removeFile(p, itemId, filename) {
  try {
    await api('DELETE', `/api/collections/${enc(state.current)}/items/${enc(itemId)}/parts/${enc(p.name)}/files/${enc(filename)}`);
    toast('Removed'); await openEditor(itemId);
  } catch (e) { toast(errMsg(e), true); }
}

async function save() {
  const body = $('#editBody');
  try {
    if (!state.editingId) {
      const id = ($('#newId').value || '').trim();
      if (!/^[a-z0-9-]+$/.test(id)) return toast('Enter a valid id (lowercase letters, numbers, hyphens).', true);
      const seed = {};
      body.querySelectorAll('form.obj-form').forEach(f => { seed[f.dataset.part] = readObjectForm(f, partByName(f.dataset.part)); });
      await api('POST', `/api/collections/${enc(state.current)}/items`, { id, parts: seed });
      toast('Created — you can now add files.');
      await openEditor(id); // reopen as edit so file managers become available
    } else {
      for (const f of body.querySelectorAll('form.obj-form')) {
        const part = partByName(f.dataset.part);
        await api('PUT', `/api/collections/${enc(state.current)}/items/${enc(state.editingId)}/parts/${enc(part.name)}`, readObjectForm(f, part));
      }
      toast('Saved');
    }
  } catch (e) { toast(errMsg(e), true); }
}

async function removeItem(id, title) {
  if (!confirm(`Delete "${title || id}"? This cannot be undone.`)) return;
  try {
    await api('DELETE', `/api/collections/${enc(state.current)}/items/${enc(id)}`);
    toast('Deleted'); showList(); await loadItems();
  } catch (e) { toast(errMsg(e), true); }
}

init();
