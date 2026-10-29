/* WA Workspace interaction polish. Existing application logic remains authoritative. */
(() => {
  'use strict';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animateActiveView(view) {
    if (!view || reducedMotion) return;
    view.classList.remove('teleport-flash');
    void view.offsetWidth;
    view.classList.add('teleport-flash');
    window.setTimeout(() => view.classList.remove('teleport-flash'), 420);
  }

  function wireNavigation() {
    document.querySelectorAll('.nav button').forEach((button) => {
      button.addEventListener('click', () => {
        window.requestAnimationFrame(() => animateActiveView(document.querySelector('.view.active')));
      });
    });
  }

  function addAccessibleLabels() {
    document.querySelectorAll('input, textarea, select').forEach((field) => {
      if (field.getAttribute('aria-label') || field.labels?.length) return;
      const placeholder = field.getAttribute('placeholder');
      if (placeholder) field.setAttribute('aria-label', placeholder);
    });
  }

  function reportRuntimeMode() {
    const badge = document.querySelector('.topRight .pill.live');
    if (!badge) return;
    badge.title = location.protocol === 'file:'
      ? 'Bundled app UI: backend operations require a running local service or configured backend.'
      : 'Workspace UI served from its current web origin.';
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireNavigation();
    addAccessibleLabels();
    reportRuntimeMode();
  });
})();