// Parallax effect for hero section
document.addEventListener('DOMContentLoaded', function() {
  const hero = document.querySelector('.hero');
  const heroContent = document.querySelector('.hero > .container');
  
  if (hero && heroContent) {
    // Parallax speed settings (adjust these values!)
    const BACKGROUND_SPEED = 0.3;  // Background moves at 30% of scroll speed (slower)
    const TEXT_SPEED = 0.6;         // Text moves at 60% of scroll speed (faster)
    const ENABLE_FADE = true;       // Fade out text while scrolling
    
    // Set custom overlay opacity if numeric value provided
    const overlayValue = hero.getAttribute('data-overlay');
    if (overlayValue && !isNaN(overlayValue) && overlayValue !== 'light' && overlayValue !== 'medium' && overlayValue !== 'dark' && overlayValue !== 'none') {
      hero.style.setProperty('--overlay-opacity', overlayValue);
    }
    
    // Initialize background position to prevent jump on first scroll
    hero.style.backgroundPosition = 'center 0px';
    
    let ticking = false;
    
    window.addEventListener('scroll', function() {
      if (!ticking) {
        window.requestAnimationFrame(function() {
          const scrolled = window.pageYOffset;
          const heroHeight = hero.offsetHeight;
          
          // Only apply parallax while hero is visible
          if (scrolled < heroHeight) {
            // Move background (slower)
            const backgroundOffset = scrolled * BACKGROUND_SPEED;
            hero.style.backgroundPosition = `center ${backgroundOffset}px`;
            
            // Move text content (faster than background)
            const contentOffset = scrolled * TEXT_SPEED;
            heroContent.style.transform = `translateY(${40 + contentOffset}px)`;
            
            // Optional: Fade out effect as you scroll
            if (ENABLE_FADE) {
              const opacity = 1 - (scrolled / heroHeight);
              heroContent.style.opacity = Math.max(opacity, 0);
            }
          }
          
          ticking = false;
        });
        
        ticking = true;
      }
    });
  }
});
