# Counting visits, and reading where they came from

GitHub Pages keeps its server logs to itself. The repo owner cannot download
them, so a site published there has no record of who read it and no way to
recover one after the fact. Whatever we want to know about readers, the page has
to say as it loads — which is what `site/count.js` is for.

It is wired into all four pages: the project site, `/app/`, `/levels/` and
`/twist/`.

## It is off until you turn it on

`site/count.js` opens with one constant:

```js
const CODE = '';
```

While that is empty the file returns before doing anything, so **no request is
made and no third party is contacted at all**. The build even proves it: with an
empty `CODE` the minifier can see the early return is unconditional and drops the
whole body, so the shipped chunk contains none of the counting code.

## Turning it on

1. Make a free site at <https://www.goatcounter.com/signup>. Non-commercial use
   is free with no expiry.
2. It gives you a subdomain, `https://<code>.goatcounter.com`. Take the `<code>`
   part.
3. Put it in `site/count.js`:

   ```js
   const CODE = 'your-code-here';
   ```

4. Push to `main`. `deploy.yml` publishes, and counting starts with the next
   visitor.

Nothing else changes. The footer note ("Visits counted without cookies") is
hidden in the HTML and unhidden by `count.js` only when it actually runs, so the
page never claims to be counting while `CODE` is empty.

## The visible tally is a second switch

`count.js` can also print the running total into that footer note ("1,234 visits
· Visits counted without cookies"). That reads `/counter/TOTAL.json` back from
GoatCounter, which is a different permission from recording a visit, and it is
**off by default**:

```js
const SHOW_TOTAL = false;
```

Leaving it off costs nothing — visits are still recorded and still show up in the
dashboard. Turning it on takes two steps, in this order:

1. In GoatCounter, under *Settings → Site settings*, enable **"Allow adding
   visitor counts to your website"**. Until this is on, the endpoint answers
   `403`.
2. Set `SHOW_TOTAL = true` in `site/count.js` and push.

Doing step 2 without step 1 puts two errors in the console of every reader —
the `403` itself, and a CORS complaint on top of it, because GoatCounter's error
response carries no `Access-Control-Allow-Origin` header. Neither can be caught
and silenced from JavaScript: the browser logs a failed request before any
`.catch()` runs. That is why the flag exists instead of just letting the fetch
fail quietly.

## What you get, and what you don't

GoatCounter resolves a **country and region** from the request's IP and then
throws the IP away rather than storing it. That country/region is the whole
reason this exists — it is the only way this site can learn where its readers
are.

You also get the path, the referrer, the browser and the screen size. You do
**not** get anything that identifies a person: no cookie is set, no cross-site
identifier is built, and there is nothing to join one visit to another. That is
also why no consent banner is needed.

Region granularity varies by country — some resolve to a state or province,
others only to the country. It is IP-based, so a reader on a VPN is counted
wherever they exit.

## The sample is kept in the path

Every stitch card on the front page links into `/app/?sample=...`, so `count.js`
keeps that one query parameter in the recorded path:

```
/app/?sample=box-stitch-15
```

That turns "someone opened the studio" into "the fifteen-round box stitch is
what pulled them in". Nothing else from the query string is kept — `?theme=`
also rides in URLs and says nothing about the reader.

## Reading it

Log in at `https://<code>.goatcounter.com` — countries are under **Locations**.

Under *Settings → Site settings* there is a "public" toggle. Turning it on gives
that same dashboard a URL anyone can open, always current, which is a better
answer than any snapshot pasted somewhere else.

The numbers are also available as JSON at
`https://<code>.goatcounter.com/api/v0/stats/locations`, if you ever want to
render them yourself.
