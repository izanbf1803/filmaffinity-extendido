// FilmAffinity Filtros: filter list items by platform, genre, country, format, year and duration.
// Flow: find film cards -> fetch each film page (throttled, cached) -> parseFilm() -> filter.

const TTL_MS = 24 * 3600 * 1000;
const WORKERS = 4;
const MIN_DELAY_MS = 500; // random pause after each network fetch, per worker
const MAX_DELAY_MS = 2000;
const BACKOFF_MS = 10000; // pause all workers after an HTTP 429

// User settings (saved in chrome.storage.sync, edited from the popup). Everything is off by default.
// Lists are stored as Sets here and as arrays when saved/sent. For each filter, an empty selection means "no restriction".
const DEFAULTS = {
  enabled: false,
  platformFilter: false, selected: [], types: [], // types empty = any type of availability counts
  genreFilter: false, selectedGenres: [],          // a film matches if it has ANY of these
  countryFilter: false, selectedCountries: [],
  kindFilter: false, selectedKinds: [],            // Película / Serie / Miniserie
  yearFilter: false, yearFrom: null, yearTo: null,
  durationFilter: false, maxDuration: null,        // minutes
};
const SET_KEYS = ['selected', 'types', 'selectedGenres', 'selectedCountries', 'selectedKinds'];

const state = {
  cards: [],            // { id, el, data: parseFilm() result | null }
  platforms: new Set(), // options seen so far in the loaded films
  genres: new Set(),
  countries: new Set(),
  done: 0,
};

const settings = () => Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, SET_KEYS.includes(k) ? [...state[k]] : state[k]]));
const applySettings = (obj) => {
  for (const k of Object.keys(DEFAULTS)) {
    if (obj[k] === undefined) continue;
    state[k] = SET_KEYS.includes(k) ? new Set(obj[k]) : obj[k];
  }
};
applySettings(DEFAULTS);

let queue = [];       // cards still to resolve, shared by the workers
let running = false;  // true while workers are active
let pausedUntil = 0;  // rate-limit backoff, shared by the workers

// ---- parsing -------------------------------------------------------------

// Returns { Suscripción: [...], Alquiler: [...], Compra: [...] } from a film page document.
function parseProviders(doc) {
  const result = {};
  const body = doc.querySelector('#stream-wrapper .body');
  if (!body) return result;
  let type = null;
  for (const node of body.children) {
    if (node.classList.contains('sub-title')) {
      type = node.textContent.trim();
    } else if (node.classList.contains('prov-offers-wrapper') && type) {
      const names = [...node.querySelectorAll('img')].map((img) => normalize(img.alt));
      result[type] = [...new Set([...(result[type] || []), ...names])];
    }
  }
  return result;
}

// "Amazon Prime Video with Ads" -> "Amazon Prime Video"
const normalize = (name) => name.replace(/ with Ads$/i, '').trim();

// Everything the filters need from a film page. Missing values are null so they never hide a film.
function parseFilm(doc) {
  const text = (sel) => doc.querySelector(sel)?.textContent.trim() || '';
  const number = (sel) => parseInt(text(sel).match(/\d+/)?.[0], 10) || null; // "60 min." -> 60

  // In dd.card-genres the genres are span[itemprop=genre]; the other links are topics.
  // The format is a "Serie de TV" genre, or a "Miniserie de TV" *topic* (not a genre span).
  const labels = [...doc.querySelectorAll('dd.card-genres a')].map((a) => a.textContent.trim());
  const isSeries = (l) => /^(mini)?serie/i.test(l);
  const genres = [...doc.querySelectorAll('dd.card-genres span[itemprop="genre"]')]
    .map((el) => el.textContent.trim())
    .filter((g) => !isSeries(g));
  const kind = labels.some((l) => /^miniserie/i.test(l)) ? 'Miniserie' : labels.some(isSeries) ? 'Serie' : 'Película';

  return {
    providers: parseProviders(doc),
    genres,
    kind,
    year: number('dd[itemprop="datePublished"]'),
    minutes: number('dd[itemprop="duration"]'),
    country: doc.querySelector('#country-img')?.parentElement.textContent.trim() || null,
  };
}

// ---- page scanning -------------------------------------------------------

// Cards are found via links to film pages. On list pages the whole entry is `li.list-row`
// (position number, buttons, movie card); hiding only the inner `.movie-card` would leave empty rows.
// Other pages fall back to the closest card-like ancestor.
const LIST_ROW = 'li.list-row';
const FALLBACK_CARD = '.movie-card, li, tr';

function findCards() {
  const byId = new Map();
  for (const a of document.querySelectorAll('a[href*="/film"]')) {
    const m = a.getAttribute('href').match(/\/film(\d+)\.html/);
    if (!m || byId.has(m[1])) continue;
    const el = a.closest(LIST_ROW) || a.closest(FALLBACK_CARD) || a.parentElement;
    byId.set(m[1], { id: m[1], el, data: null });
  }
  return [...byId.values()];
}

// ---- fetching + cache ----------------------------------------------------

const cacheKey = (id) => 'fa:' + id;
// Bump CACHE_VERSION when parseFilm() returns new fields: older entries then count as stale.
const CACHE_VERSION = 2;
const isFresh = (entry) => entry && entry.v === CACHE_VERSION && Date.now() - entry.t < TTL_MS;

async function fetchFilm(id) {
  const res = await fetch(`/${location.pathname.split('/')[1]}/film${id}.html`, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = parseFilm(new DOMParser().parseFromString(await res.text(), 'text/html'));
  await chrome.storage.local.set({ [cacheKey(id)]: { v: CACHE_VERSION, t: Date.now(), data } });
  return data;
}

// data = null means the fetch failed; the card then stays visible.
function markLoaded(card, data) {
  card.data = data;
  card.loaded = true;
  state.done++;
  if (!data) return;
  for (const names of Object.values(data.providers)) names.forEach((n) => state.platforms.add(n));
  data.genres.forEach((g) => state.genres.add(g));
  if (data.country) state.countries.add(data.country);
}

// Resolves every queued card that has a fresh cache entry, with one storage read and one filter pass.
async function resolveFromCache() {
  const stored = await chrome.storage.local.get(queue.map((c) => cacheKey(c.id)));
  queue = queue.filter((card) => {
    const entry = stored[cacheKey(card.id)];
    if (!isFresh(entry)) return true;
    markLoaded(card, entry.data);
    return false;
  });
  applyFilter();
}

async function worker() {
  while (state.enabled && queue.length) {
    const card = queue.shift();
    if (pausedUntil > Date.now()) await sleep(pausedUntil - Date.now());
    try {
      markLoaded(card, await fetchFilm(card.id));
    } catch (e) {
      console.warn('[fa-filter] film', card.id, e.message);
      if (String(e.message).includes('HTTP 429')) pausedUntil = Date.now() + BACKOFF_MS;
      markLoaded(card, null);
    }
    applyFilter();
    await sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
  }
}

// Starts WORKERS workers on the shared queue. Safe to call again: it resumes after being switched off.
async function loadAll() {
  if (running || !state.enabled) return;
  running = true;
  await resolveFromCache();
  await Promise.all(Array.from({ length: WORKERS }, worker));
  running = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- filtering -----------------------------------------------------------

const platformActive = () => state.platformFilter && state.selected.size > 0;
const genreActive = () => state.genreFilter && state.selectedGenres.size > 0;
const countryActive = () => state.countryFilter && state.selectedCountries.size > 0;
const kindActive = () => state.kindFilter && state.selectedKinds.size > 0;
const yearActive = () => state.yearFilter && (state.yearFrom || state.yearTo);
const durationActive = () => state.durationFilter && state.maxDuration > 0;
const anyActive = () => state.enabled &&
  [platformActive, genreActive, countryActive, kindActive, yearActive, durationActive].some((f) => f());

// A film is shown when it passes every active filter. Values a film page doesn't have never hide it.
function matches(card) {
  if (!state.enabled || !card.data) return true; // not loaded yet (or failed): keep visible rather than hide unknowns
  const { providers, genres, kind, year, minutes, country } = card.data;
  if (platformActive()) {
    const types = state.types.size ? [...state.types] : Object.keys(providers);
    if (!types.some((t) => (providers[t] || []).some((p) => state.selected.has(p)))) return false;
  }
  if (genreActive() && !genres.some((g) => state.selectedGenres.has(g))) return false;
  if (countryActive() && country && !state.selectedCountries.has(country)) return false;
  if (kindActive() && !state.selectedKinds.has(kind)) return false;
  if (yearActive() && year && ((state.yearFrom && year < state.yearFrom) || (state.yearTo && year > state.yearTo))) return false;
  if (durationActive() && minutes && minutes > state.maxDuration) return false;
  return true;
}

function applyFilter() {
  const filtering = anyActive();
  for (const card of state.cards) {
    card.el.classList.toggle('fafx-hidden', !matches(card));
    card.el.classList.toggle('fafx-pending', filtering && !card.loaded); // dimmed until its data is known
  }
}

// Saving is debounced: typing numbers in the popup would otherwise exceed chrome.storage.sync's write limits.
let saveTimer;
const saveSoon = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.sync.set(settings()), 500);
};

// ---- popup messaging -----------------------------------------------------

// The filter UI lives in the extension popup (src/popup/); it polls with 'get' and updates with 'set'.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'set') {
    applySettings(msg);
    applyFilter();
    saveSoon();
    loadAll();
  }
  reply({
    ...settings(),
    platforms: [...state.platforms].sort(),
    genres: [...state.genres].sort(),
    countries: [...state.countries].sort(),
    done: state.done,
    total: state.cards.length,
  });
});

// ---- main ----------------------------------------------------------------

async function main() {
  if (/\/film\d+\.html/.test(location.pathname)) return; // single film page
  state.cards = findCards();
  if (state.cards.length < 2) return; // not a list page
  applySettings(await chrome.storage.sync.get(Object.keys(DEFAULTS)));
  // Saved selections must show up as options even before they are seen.
  state.selected.forEach((p) => state.platforms.add(p));
  state.selectedGenres.forEach((g) => state.genres.add(g));
  state.selectedCountries.forEach((c) => state.countries.add(c));

  queue = [...state.cards];
  applyFilter();
  loadAll();
}

main();
