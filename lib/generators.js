// Generator name resolution.
//
// A generator is referenced by NAME (from a template page's generatorOptions);
// the name maps to a file via generators/registry.json. The engine ships default
// names and a site can add or override entries (site wins); the resolved file is
// then located site-first across the two generators/ dirs.
//
// registry.json is slated for a future overhaul, so this module is the SINGLE
// place that knows its on-disk shape. Keep that shape minimal: { "<name>": "<file>" }.

const fs = require('fs');
const path = require('path');

// Merge the name->file registry: engine first, site applied over it (site wins).
function readGeneratorRegistry(engineGeneratorsDir, siteGeneratorsDir) {
  const merged = {};
  for (const dir of [engineGeneratorsDir, siteGeneratorsDir]) {
    if (!dir) continue;
    const file = path.join(dir, 'registry.json');
    if (!fs.existsSync(file)) continue;
    try {
      Object.assign(merged, JSON.parse(fs.readFileSync(file, 'utf8')) || {});
    } catch (error) {
      console.log('  [WARNING] Failed to parse generators/registry.json:', error.message);
    }
  }
  return merged;
}

// Resolve a generator name to an absolute file path: look the name up in the
// merged registry, then resolve that filename site-first. Returns null if the
// name is unregistered or its file is missing from both dirs.
function resolveGenerator(name, { engineGeneratorsDir, siteGeneratorsDir }) {
  const filename = readGeneratorRegistry(engineGeneratorsDir, siteGeneratorsDir)[name];
  if (!filename) return null;
  for (const dir of [siteGeneratorsDir, engineGeneratorsDir]) {
    if (!dir) continue;
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

module.exports = { readGeneratorRegistry, resolveGenerator };
