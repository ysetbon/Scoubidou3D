/* The little bit of behaviour the mocks need to be judged as interfaces rather
 * than as pictures: the theme switch, the About sheet's open and close, and (in
 * mock 3) the dock's popovers. No framework, no build — the mocks stay openable
 * straight off disk.
 */

(() => {
  const root = document.documentElement;

  /* ---- theme -------------------------------------------------------------
     Order of authority: ?theme= in the URL (which is how the renders are shot),
     then a previous choice, then the OS. The attribute is always written out
     rather than left to the media query, so the toggle can override the OS in
     both directions. */
  const params = new URLSearchParams(location.search);
  const stored = (() => {
    try {
      return localStorage.getItem('s3d-panel-theme');
    } catch {
      return null;
    }
  })();
  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const start = params.get('theme') || stored || (prefersDark ? 'dark' : 'light');

  const MOON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.6 2.1A9.9 9.9 0 1 0 21.9 15 8 8 0 0 1 12.6 2.1Z"/></svg>';
  const SUN =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.6"/>' +
    '<path d="M11 .8h2v3.6h-2zm0 18.8h2v3.6h-2zM.8 11h3.6v2H.8zm18.8 0h3.6v2h-3.6z' +
    'M3.5 4.9 4.9 3.5l2.6 2.5L6 7.5zm13 13 1.4-1.4 2.6 2.5-1.5 1.5zM4.9 20.5 3.5 19l2.5-2.5 1.5 1.4z' +
    'm13-13L16.5 6 19 3.5l1.5 1.4z"/></svg>';

  function setTheme(name) {
    root.dataset.theme = name;
    try {
      localStorage.setItem('s3d-panel-theme', name);
    } catch {
      /* a file:// page can have storage refused; the attribute still holds */
    }
    for (const b of document.querySelectorAll('[data-act="theme"]')) {
      const dark = name === 'dark';
      b.innerHTML = dark ? SUN : MOON;
      b.title = dark ? 'Switch to the light theme' : 'Switch to the dark theme';
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(dark));
    }
  }

  setTheme(start === 'dark' ? 'dark' : 'light');

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="theme"]');
    if (!b) return;
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* ---- the About sheet ---------------------------------------------------
     One sheet per panel: the ? opens it, its own ✕ and Escape put it away, and
     where the ? is still uncovered (mock 3, where it sits over the canvas) a
     second press closes it too. In mocks 1 and 2 the sheet takes the whole panel
     including the header, and its ✕ lands exactly where the ? was — the same
     gesture in the same place.

     Focus follows the sheet in and back out again, so the whole thing works from
     the keyboard; the sheet is the only route to the prose, which makes that
     non-optional rather than a nicety. */

  /* The strip below the app frame carries the About area as a still, at true
     panel width. That still is the single copy of the text: the working sheet in
     the panel is cloned from it, so the two can never drift apart. */
  const still = document.querySelector('.aboutHost .sheet');
  if (still) {
    for (const panel of document.querySelectorAll('.app .panel')) {
      if (panel.querySelector('.sheet')) continue;
      const copy = still.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      panel.appendChild(copy);
    }
  }

  let opener = null;

  /* The ? lives in the panel's own header in mocks 1 and 2, and over the canvas
     in mock 3 — either way it opens the one sheet in the app frame. */
  function sheetOf(el) {
    const panel = el.closest('.panel');
    return (panel || el.closest('.app') || document).querySelector('.sheet');
  }

  function openSheet(sheet, from) {
    if (!sheet || sheet.classList.contains('open')) return;
    sheet.classList.add('open');
    sheet.removeAttribute('aria-hidden');
    opener = from || null;
    const close = sheet.querySelector('[data-act="about-close"]');
    if (close) close.focus({ preventScroll: true });
    if (from) from.setAttribute('aria-expanded', 'true');
  }

  function closeSheet(sheet) {
    if (!sheet || !sheet.classList.contains('open')) return;
    sheet.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    if (opener) {
      opener.setAttribute('aria-expanded', 'false');
      opener.focus({ preventScroll: true });
      opener = null;
    }
  }

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-act="about"]');
    if (open) {
      const sheet = sheetOf(open);
      if (sheet && sheet.classList.contains('open')) closeSheet(sheet);
      else openSheet(sheet, open);
      return;
    }
    const shut = e.target.closest('[data-act="about-close"]');
    if (shut) closeSheet(shut.closest('.sheet'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = document.querySelectorAll('.sheet.open');
    if (!open.length) return;
    for (const s of open) closeSheet(s);
    /* Claim the key, so whatever else listens for Escape — the dock below —
       leaves its own state alone this time round. */
    e.preventDefault();
  });

  /* ---- mock 3's dock ----------------------------------------------------
     Four pills, one popover at a time: pressing another pill swaps the popover,
     pressing the live one puts it away. */

  const dock = document.querySelector('.dock');
  if (dock) {
    const pops = new Map();
    for (const p of document.querySelectorAll('.pop')) pops.set(p.dataset.pop, p);

    const show = (key) => {
      for (const [k, p] of pops) p.classList.toggle('open', k === key);
      for (const b of dock.querySelectorAll('button')) {
        const on = b.dataset.pop === key;
        b.classList.toggle('on', on);
        b.setAttribute('aria-expanded', String(on));
      }
    };

    dock.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-pop]');
      if (!b) return;
      show(b.classList.contains('on') ? null : b.dataset.pop);
    });

    /* Escape closes the topmost thing only: with the About sheet up, the key
       belongs to the sheet and the popover stays where it was. */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      show(null);
    });
  }
})();
