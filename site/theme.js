/* The theme switch, shared by every page of the site.
 *
 * The studio (src/ui/panel.ts) does the same thing with the same storage key, so
 * a choice made in the app holds when you come back out to the site and the other
 * way round — the two are one object, and clicking "Open the studio" should not
 * change the lights.
 *
 * Order of authority: a previous choice, then the OS. The attribute is always
 * written out rather than left to a media query, so the button can override the
 * OS in both directions — a light-mode laptop at 2am is exactly the case a media
 * query alone cannot answer.
 */
(() => {
  const KEY = 'scoubidou3d-theme';
  const root = document.documentElement;

  const stored = (() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null; // storage refused (private mode, sandboxed frame)
    }
  })();

  const MOON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.1A9.9 9.9 0 1 0 21.9 15 8 8 0 0 1 12.6 2.1Z"/></svg>';
  const SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6"/>' +
    '<path d="M11 .8h2v3.6h-2zm0 18.8h2v3.6h-2zM.8 11h3.6v2H.8zm18.8 0h3.6v2h-3.6z' +
    'M3.5 4.9 4.9 3.5l2.6 2.5L6 7.5zm13 13 1.4-1.4 2.6 2.5-1.5 1.5zM4.9 20.5 3.5 19l2.5-2.5 1.5 1.4z' +
    'm13-13L16.5 6 19 3.5l1.5 1.4z"/></svg>';

  function apply(name) {
    root.dataset.theme = name;
    const dark = name === 'dark';
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      b.innerHTML = dark ? SUN : MOON;
      b.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(dark));
    }
  }

  apply(stored || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-theme-toggle]')) return;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Not fatal: the attribute is what styles the page.
    }
    apply(next);
  });
})();
