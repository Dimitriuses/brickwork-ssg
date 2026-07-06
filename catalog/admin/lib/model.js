'use strict';
// Data-model helpers for the admin — self-contained (no engine require) so an adopted, site-owned
// copy runs standalone. Mirrors the engine's item resolution: a collection's `data_model` maps part
// names to { match, type }, and each item is a folder under the collection `source`. Per part `type`:
//   object     — a single JSON file (the first match), read/written whole
//   paths      — every matched file (e.g. images)
//   file_path  — a single matched file
// This module only reads the file layer; the server owns HTTP, uploads, and path-safety.

const fs = require('fs');
const path = require('path');

// Minimal glob -> RegExp (case-insensitive), copied from the engine's lib/glob.js so the admin stays
// self-contained. Supports *  **  ?  {a,b}. Everything else is literal.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) { re += '\\{'; continue; }
      const alts = glob.slice(i + 1, end).split(',').map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      re += '(?:' + alts.join('|') + ')';
      i = end;
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$', 'i');
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// Immediate file names in a dir (sorted); [] if the dir is absent.
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name).sort();
}

// A collection's data_model as a normalized part list: [{ name, type, match, regex, required, schema }].
function modelParts(collection) {
  const model = (collection && collection.data_model) || {};
  return Object.entries(model).map(([name, p]) => ({
    name,
    type: (p && p.type) || 'file_path',
    match: (p && p.match) || '*',
    regex: globToRegExp((p && p.match) || '*'),
    required: !!(p && p.required),
    schema: (p && p.schema) || null
  }));
}

// Files in an item folder matching a part's glob.
function partFiles(itemDir, part) {
  return listFiles(itemDir).filter(f => part.regex.test(f));
}

// The filename to write an object part to: the existing match if any, else the `match` when it is a
// literal filename (no glob metacharacters). Returns null when it can't be determined (a glob match on
// a not-yet-created file) — the caller turns that into a 400.
function objectFileName(itemDir, part) {
  const existing = partFiles(itemDir, part)[0];
  if (existing) return existing;
  if (part.match && !/[*?{}]/.test(part.match)) return part.match;
  return null;
}

// Read one item's parts into a value map (raw file layer): object -> parsed JSON | null,
// paths -> [filename], file_path -> filename | null.
function readItemParts(itemDir, parts) {
  const out = {};
  for (const part of parts) {
    const matched = partFiles(itemDir, part);
    if (part.type === 'object') out[part.name] = matched.length ? readJsonSafe(path.join(itemDir, matched[0])) : null;
    else if (part.type === 'paths') out[part.name] = matched;
    else out[part.name] = matched.length ? matched[0] : null; // file_path
  }
  return out;
}

module.exports = { globToRegExp, readJsonSafe, listFiles, modelParts, partFiles, objectFileName, readItemParts };
