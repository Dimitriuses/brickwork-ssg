// Example SITE-authored test (Phase D). Run after the build with
// `ssg test --site example`. It receives:
//   ctx = { siteRoot, buildDir, read(file), check(name, ok, detail), standardChecks }
// and asserts site-specific facts on top of the engine's standard checks.
module.exports = ({ read, check }) => {
  check('home shows the pricing section', /class="pricing"/.test(read('index.html')));
  check('shop lists products', /product-card/.test(read('shop.html')));
  check('news generator produced a page', read('news-theming.html').length > 0);
};
