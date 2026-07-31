/* Counting visits, shared by every page of the site.
 *
 * Why anything at all: GitHub Pages hands its server logs to nobody, not even
 * the repo owner, so a site published there has no record of who read it. If we
 * want to know which countries the readers are in, the page has to say so as it
 * loads — there is no log to go back and read afterwards.
 *
 * Why GoatCounter: it sets no cookie and builds no cross-site identifier, so it
 * needs no consent banner. It resolves a country and region from the request's
 * IP and then discards the IP rather than storing it, which is exactly the trade
 * we want — the map without the surveillance.
 *
 * Inert until CODE is filled in. An empty CODE makes no request whatsoever, so
 * the page contacts no third party at all until someone deliberately turns this
 * on. That is what lets this file sit on main while the account behind it is
 * still being made, instead of waiting in a branch for the one string it needs.
 *
 * To turn it on: make a free site at https://www.goatcounter.com/signup, then
 * put its code below — the <code> part of https://<code>.goatcounter.com.
 */
(() => {
  const CODE = '';

  if (!CODE) return;

  /* Settings have to exist before count.js runs, because it reads them on load.
   *
   * The sample is worth keeping in the path: every stitch on the front page is a
   * link into /app/?sample=..., so recording it turns "someone opened the studio"
   * into "the box stitch is what pulled them in". Nothing else is added — the
   * query string can carry a theme override too, and that says nothing about the
   * reader. */
  window.goatcounter = {
    path: (path) => {
      const sample = new URLSearchParams(location.search).get('sample');
      return sample ? `${path}?sample=${sample}` : path;
    },
  };

  /* GoatCounter ignores localhost on its own, so a dev server stays out of the
   * counts without us checking for it here. */
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://gc.zgo.at/count.js';
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  document.head.appendChild(s);

  /* Say so in the footer, but only from here — a note written into the HTML
   * would claim a thing that is not happening for as long as CODE is empty.
   * This module is deferred, so the footer is parsed by the time we look. */
  for (const note of document.querySelectorAll('[data-count-note]')) note.hidden = false;
})();
