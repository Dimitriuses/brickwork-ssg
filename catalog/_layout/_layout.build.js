// Layout Component Build Script
// Owns the header-mode derivation entirely (the build does not process it): read the page's
// `header_theme` layout var (from `layout.vars`, forwarded verbatim by buildPage), default it to
// 'light', and expose it as HEADER_MODE. Setting it on `vars` — rather than a locally-scoped copy —
// means the nested {{COMPONENT:header}}, which buildComponent resolves with these same vars, receives
// HEADER_MODE too (same mutate-vars pattern as products.build.js). So the mode is purely a layout
// concern.

function build(vars, loadComponent, replaceVariables) {
  vars.HEADER_MODE = vars.header_theme || 'light';

  const template = loadComponent('_layout');
  return replaceVariables(template, vars);
}

module.exports = { build };
