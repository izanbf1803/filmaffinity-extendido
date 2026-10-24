# FilmAffinity Filtros (Chrome extension)

## Objective

**Audience:** the extension is for Spanish users. It targets the Spanish site (`filmaffinity.com/es/`), and its UI text is in Spanish.

Extend https://www.filmaffinity.com/es/ with advanced, custom filtering that the site doesn't offer, applied directly on the pages the user already uses (their lists, and later search results).

**Phase 1 (current goal):** filter the items of *my lists* by:
- Availability on a chosen set of streaming platforms (Netflix, Max, Prime Video, Disney+, Movistar+, Filmin, ...), for the user's country (Spain by default).
- Other criteria, added incrementally: year range, genre, FA rating, rating count, runtime, country, my own rating / watched state.

**Later phases:** same filters on search results and other listing pages; saved filter presets; sorting; "hide watched".

**Non-goals:** scraping FA at scale, a backend server, replacing FA's UI.

## Key facts and open risks

| Topic | Finding |
|---|---|
| Streaming availability | **Each film page (e.g. `/es/film685396.html`) has a "Disponible en" section** listing platforms. Not shown in list pages, so it requires one fetch per film. Primary source. Markup documented below. |
| Fetching film pages | A content script on `www.filmaffinity.com` can `fetch()` other FA film pages same-origin (no CORS, no extra host permission, uses the user's session/cookies, no API key). Parse the response with `DOMParser`. Needs throttling (e.g. 1-2 concurrent, small delay) and long-lived caching to avoid rate limiting/captchas. |
| Fallback external source (TMDB) | TMDB `GET /movie/{id}/watch/providers` (and `/tv/{id}/...`), per-country results, data powered by JustWatch. Free API key. **Must credit JustWatch** and link to the TMDB-provided URL (no deep links). Source: [TMDB support thread](https://www.themoviedb.org/talk/5ff0a2b7176a940045e88665), [library docs quoting the terms](https://crystaldoc.info/github/mmacia/tmdb.cr/v0.5.0/Tmdb/WatchProvider.html). Re-check current TMDB terms before publishing. |
| FA → TMDB mapping | Only needed if TMDB is used as fallback. FA has no TMDB id. Match by original title + year (TMDB `search/movie`, `search/tv`), cache the result. Ambiguity is the main correctness risk; allow manual override. IMDb id via TMDB `/find` is more reliable if FA pages expose one (unverified). |
| FA DOM | **Not yet inspected**: FA returns HTTP 403 to non-browser fetches. Selectors/URLs for lists must be discovered in DevTools on a logged-in session (see TODO). |
| Cross-origin fetch | Content scripts are subject to the page's CORS. Network calls to TMDB must go through the MV3 service worker, which needs `host_permissions` ([Chrome docs](https://developer.chrome.com/docs/extensions/mv3/xhr)). |
| Service worker lifecycle | Terminates when idle; no `localStorage`; keep state in `chrome.storage`, not in memory. |

## "Disponible en" markup (from a film page)

```html
<div class="film-right-box vod-wrapper" id="stream-wrapper" data-movie-id="747981">
  <div class="title">Disponible en</div>
  <div class="body">
    <div class="sub-title">Suscripción</div>   <!-- also "Alquiler", "Compra" -->
    <div class="prov-offers-wrapper">
      <a href=".../es/jwredirect.php?link=<hash>"><img class="icon-2" alt="Amazon Prime Video" title="Amazon Prime Video" src="https://images.justwatch.com/icon/<id>/s100"></a>
      ...
    </div>
    ...
  </div>
  <div class="justwatch-logo"><a href="https://www.justwatch.com/es/pelicula/<slug>">...</a></div>
</div>
```

Parsing rules:
- Root: `#stream-wrapper`. Absent root = no availability data (store an empty result, don't retry forever).
- Walk `.body` children in order: each `.sub-title` text (`Suscripción` / `Alquiler` / `Compra`) is followed by a `.prov-offers-wrapper` holding the providers of that type. Map to `flatrate` / `rent` / `buy`.
- Provider name = `img` `alt`/`title`. The JustWatch icon id in the `src` (`/icon/<id>/s100`) is a stable provider id, better to key on than the name. Rakuten TV's icon id `128599720` repeats across rent and buy, so it is consistent.
- Variants must be normalised: "Amazon Prime Video" and "Amazon Prime Video with Ads" are separate entries and should be grouped under one platform in the filter UI.
- Links go through FA's `jwredirect.php`, so keep them for badges but don't use them as keys.
- JustWatch attribution is already part of FA's block (`.justwatch-logo`); show a small "Datos: JustWatch" credit in our bar as well.
- `data-movie-id` (747981 in the sample) may or may not be FA's own film id. Don't rely on it; take the id from the URL / card link.
- "Phase 1 filter" semantics: default to Suscripción only, with a toggle to include Alquiler / Compra.

## Proposed architecture (Manifest V3)

```
manifest.json
content/            content script on FA list pages
  list.js           parse items, render filter bar, hide/show cards
  filter-bar.css
background/
  service-worker.js TMDB lookups (search + watch providers), rate limiting, cache
options/            options page: TMDB API key, country, favourite platforms
```

- **manifest.json**: `manifest_version: 3`; `content_scripts.matches`: `https://www.filmaffinity.com/*/mylist*`, `.../userratings*` etc. (exact paths TBD); `permissions: ["storage"]`; `host_permissions: ["https://api.themoviedb.org/*"]`.
- **Content script**: reads each list card (title, year, FA film id from the `/film<ID>.html` link), fetches each film page itself (same-origin), parses "Disponible en" (and other fields: genres, runtime, rating), stores the data on the card (`data-*`), injects a filter bar, and toggles card visibility. Use a `MutationObserver` in case the list paginates/lazy-loads.
- **Service worker** (minimal in phase 1): owns the cache in `chrome.storage.local` (FA id → parsed film data + timestamp, TTL e.g. 3-7 days, since availability changes) and, optionally, the TMDB fallback. Fetch queue with a small concurrency limit lives in the content script (or a shared module).
- **Settings** in `chrome.storage.sync`: selected platforms, filter presets (and TMDB key in `local` only if the fallback is enabled).
- **Enrichment UX**: filters apply progressively as data arrives; show a progress counter ("312/480 resolved"); badge platform logos on each card (with JustWatch attribution in the filter bar footer).
- **Stack**: plain JS/TS; Vite + `@crxjs/vite-plugin` (or esbuild) if TypeScript is wanted. No framework needed at phase 1.

## Data flow

```
FA list page ──parse──▶ [{faId, title, year}]
      │                         │
      ▼                         ▼
 filter bar ◀── enriched ── queue ──▶ fetch /es/film<ID>.html ──▶ parse "Disponible en"
      │                         ▲
   hide/show cards        chrome.storage.local cache
```

## Alternatives considered

- **JustWatch directly**: unofficial GraphQL API, no terms allowing it, can break anytime. Avoid.
- **TMDB/JustWatch as primary**: no longer preferred now that FA's own "Disponible en" is known; keep as optional fallback/cross-check (needs API key, attribution, title+year matching).
- **Watchmode / Streaming Availability API**: paid/limited tiers; keep as swap-in providers behind a small interface (`getProviders(title, year, country)`).

## Milestones

1. Skeleton extension loads, injects a filter bar on a list page (manual test in `chrome://extensions` → Load unpacked).
2. Parse list items reliably (title, year, FA id).
3. Throttled film-page fetcher + "Disponible en" parser + cache.
4. Platform filter + platform badges on cards + options page.
5. Extra filters (year, genre, rating, etc.), saved presets.
6. Extend to search results.

## TODO / to verify

- [x] "Disponible en" markup captured (see above). Streaming / rent / buy are separated.
- [ ] Confirm the block is present in the raw HTML returned by `fetch()` (not injected by JS after load) and whether it differs when logged out or by country. Quick check: `curl`-equivalent via DevTools console `fetch(location.href).then(r=>r.text()).then(t=>t.includes('stream-wrapper'))`.
- [ ] Measure how many film-page requests FA tolerates before throttling/captcha.
- [ ] In DevTools on a logged-in FA session, document: list page URLs, card markup/selectors, pagination behaviour, whether year/original title/IMDb id are present in the list or only on film pages.
- [ ] Decide on handling FA ratings/genres for filtering (parse from list vs fetch film pages).
- [ ] Only if TMDB fallback is kept: confirm current TMDB API terms (attribution, caching limits).
- [ ] Decide TS vs JS and build tooling.
- [ ] Privacy: all data stays in the browser; with the FA-only approach nothing leaves the browser except requests to filmaffinity.com.

## Sources

- [Chrome: Cross-origin network requests](https://developer.chrome.com/docs/extensions/mv3/xhr)
- [TMDB support: watch providers](https://www.themoviedb.org/talk/5ff0a2b7176a940045e88665)
- [Watch provider docs quoting JustWatch attribution requirement](https://crystaldoc.info/github/mmacia/tmdb.cr/v0.5.0/Tmdb/WatchProvider.html)
