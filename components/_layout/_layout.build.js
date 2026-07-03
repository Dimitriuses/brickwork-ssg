// Layout Component Build Script
// Owns the header-mode derivation (previously hardcoded in build.js's buildPage): default the
// page's raw header_theme (passed as HEADER_THEME) to 'light' and expose it as HEADER_MODE. Setting
// it on `vars` — rather than a locally-scoped copy — means the nested {{COMPONENT:header}}, which
// buildComponent resolves with these same vars, receives HEADER_MODE too (same mutate-vars pattern
// as products.build.js). So the mode is a layout concern, not a build-wide global var.

function build(vars, loadComponent, replaceVariables) {
  vars.HEADER_MODE = vars.HEADER_THEME || 'light';

  const template = loadComponent('_layout');
  return replaceVariables(template, vars);
}

module.exports = { build };
