// Test component: receives per-item vars resolved from $-paths (LABEL = $data.name scalar,
// IMAGES = $images array). Proves both scalar and array per-item component vars reach a component.
function build(vars, loadComponent, replaceVariables) {
  const images = Array.isArray(vars.IMAGES) ? vars.IMAGES : [];
  return replaceVariables(loadComponent('badge'), {
    LABEL: vars.LABEL || '',
    COUNT: String(images.length)
  });
}
module.exports = { build };
