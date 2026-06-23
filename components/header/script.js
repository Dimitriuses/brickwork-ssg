// Header scroll effect and navigation
document.addEventListener('DOMContentLoaded', function() {
  const navbar = document.getElementById('mainNav');
  if (!navbar) return;
  
  const navbarStyle = navbar.getAttribute('data-navbar-style') || 'light';
  
  // Set initial navbar theme
  if (navbarStyle === 'dark') {
    navbar.classList.add('navbar-dark');
    navbar.classList.remove('navbar-light');
  } else {
    navbar.classList.add('navbar-light');
    navbar.classList.remove('navbar-dark');
  }
  
  function updateNavbar() {
    if (window.scrollY > 50) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }
  
  // Update on scroll
  window.addEventListener('scroll', updateNavbar);
  
  // Update on load (in case page is already scrolled)
  updateNavbar();
  
  // Add active class to current nav item
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = document.querySelectorAll('.nav-link');
  
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
});
