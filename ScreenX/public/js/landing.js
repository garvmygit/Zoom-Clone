// simple landing animations
document.addEventListener('DOMContentLoaded', () => {
  const logo = document.querySelector('header a div');
  if (logo) {
    logo.style.transition = 'transform 1s ease, filter 1s ease';
    requestAnimationFrame(() => {
      logo.style.transform = 'scale(1.05)';
      logo.style.filter = 'drop-shadow(0 0 10px rgba(139,92,246,0.6))';
    });
  }
});





