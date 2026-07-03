// Carousel behaviour. The build emits only slides + thumbnails; this injects the prev/next controls
// and indicators for any carousel with more than one slide (keeping that chrome out of the server
// markup), and wires thumbnail clicks. Bootstrap (loaded by the layout) performs the sliding.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.product-detail-images .carousel').forEach(function (carousel) {
    var items = carousel.querySelectorAll('.carousel-item');
    if (items.length < 2 || !carousel.id) return;
    var target = '#' + carousel.id;

    var indicators = '<div class="carousel-indicators">';
    for (var i = 0; i < items.length; i++) {
      indicators += '<button type="button" data-bs-target="' + target + '" data-bs-slide-to="' + i + '"'
        + (i === 0 ? ' class="active" aria-current="true"' : '')
        + ' aria-label="Slide ' + (i + 1) + '"></button>';
    }
    indicators += '</div>';

    var controls =
      '<button class="carousel-control-prev" type="button" data-bs-target="' + target + '" data-bs-slide="prev">'
      + '<span class="carousel-control-prev-icon" aria-hidden="true"></span>'
      + '<span class="visually-hidden">Previous</span></button>'
      + '<button class="carousel-control-next" type="button" data-bs-target="' + target + '" data-bs-slide="next">'
      + '<span class="carousel-control-next-icon" aria-hidden="true"></span>'
      + '<span class="visually-hidden">Next</span></button>';

    carousel.insertAdjacentHTML('beforeend', indicators + controls);
  });

  document.querySelectorAll('.thumbnail-image').forEach(function (thumbnail) {
    thumbnail.addEventListener('click', function () {
      var carouselTarget = this.getAttribute('data-bs-target');
      var slideIndex = this.getAttribute('data-bs-slide-to');
      if (carouselTarget && slideIndex) {
        var carousel = document.querySelector(carouselTarget);
        if (carousel) {
          var bsCarousel = bootstrap.Carousel.getInstance(carousel) || new bootstrap.Carousel(carousel);
          bsCarousel.to(parseInt(slideIndex, 10));
        }
      }
    });
  });
});
