// Product detail page - thumbnail click to navigate carousel
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.thumbnail-image').forEach(thumbnail => {
    thumbnail.addEventListener('click', function() {
      const carouselTarget = this.getAttribute('data-bs-target');
      const slideIndex = this.getAttribute('data-bs-slide-to');
      
      if (carouselTarget && slideIndex) {
        const carousel = document.querySelector(carouselTarget);
        if (carousel) {
          const bsCarousel = bootstrap.Carousel.getInstance(carousel) || new bootstrap.Carousel(carousel);
          bsCarousel.to(parseInt(slideIndex));
        }
      }
    });
  });
});
