// Example SITE-authored test (Phase D). Run after the build with
// `ssg test --site example`. It receives:
//   ctx = { siteRoot, buildDir, read(file), check(name, ok, detail), standardChecks }
// and asserts site-specific facts on top of the engine's standard checks.
module.exports = ({ read, check }) => {
  check('home shows the pricing section', /class="pricing"/.test(read('index.html')));
  check('shop lists products', /product-card/.test(read('shop.html')));
  // The product detail page is generator-free (data_model + map + carousel component).
  const detail = read('product-sample-1.html');
  check('detail page rendered (generator-free, carousel component)',
    /product-detail-images/.test(detail) && /Brick A/.test(detail));
};
