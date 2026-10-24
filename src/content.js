// FilmAffinity Filtros: filter list items by streaming platform, genre and format (film/series).
// Flow: find film cards -> fetch each film page (throttled, cached) -> parse "Disponible en" + genres -> filter.

const TTL_MS = 24 * 3600 * 1000;
const WORKERS = 4;
const MIN_DELAY_MS = 500; // random pause after each network fetch, per worker
const MAX_DELAY_MS = 2000;
const BACKOFF_MS = 10000; // pause all workers after an HTTP 429

const state = {
  cards: [],            // { id, el, data: { providers: {type: [platform]}, genres: [genre], kind } | null }
  platforms: new Set(), // platforms seen so far
  selected: new Set(),  // platforms the user ticked
  types: new Set(),     // empty = any type of availability counts
  enabled: false,       // master switch (everything is off by default)
  platformFilter: false, // on/off for the platform filter (selection is kept while off)
  genres: new Set(),    // genres seen so far
  selectedGenres: new Set(), // a film matches if it has ANY of these
  genreFilter: false,   // on/off for the genre filter
  kindFilter: false,    // on/off for the format filter (Película / Serie / Miniserie)
  selectedKinds: new Set(), // a film matches if its format is ANY of these
  done: 0,
};

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

// Returns the raw genre labels, e.g. ['Ciencia ficción', 'Thriller'] (topics like "Distopía" are not genres).
// FilmAffinity also lists the format here ("Serie de TV"); withKind() separates it out.
function parseGenres(doc) {
  return [...doc.querySelectorAll('dd.card-genres span[itemprop="genre"]')].map((el) => el.textContent.trim());
}

// Splits the format out of the genre labels: 'Película' unless a "Serie..." / "Miniserie..." label is present.
// The cache keeps the raw labels, so this is applied after reading it.
function withKind({ providers, genres }) {
  const kindOf = (g) => (/^miniserie/i.test(g) ? 'Miniserie' : /^serie/i.test(g) ? 'Serie' : null);
  const kinds = genres.map(kindOf).filter(Boolean);
  return {
    providers,
    genres: genres.filter((g) => !kindOf(g)),
    kind: kinds.includes('Miniserie') ? 'Miniserie' : kinds[0] || 'Película',
  };
}

// "Amazon Prime Video with Ads" -> "Amazon Prime Video"
const normalize = (name) => name.replace(/ with Ads$/i, '').trim();

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
// Entries cached before genres were added have no `genres` and count as stale.
const isFresh = (entry) => entry && Array.isArray(entry.genres) && Date.now() - entry.t < TTL_MS;

async function fetchFilm(id) {
  const res = await fetch(`/${location.pathname.split('/')[1]}/film${id}.html`, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const data = { providers: parseProviders(doc), genres: parseGenres(doc) };
  await chrome.storage.local.set({ [cacheKey(id)]: { t: Date.now(), ...data } });
  return data;
}

// data = null means the fetch failed; the card then stays visible.
function markLoaded(card, raw) {
  const data = raw && withKind(raw);
  card.data = data;
  card.loaded = true;
  state.done++;
  for (const names of Object.values(data?.providers || {})) names.forEach((n) => state.platforms.add(n));
  (data?.genres || []).forEach((g) => state.genres.add(g));
}

// Resolves every queued card that has a fresh cache entry, with one storage read and one filter pass.
async function resolveFromCache() {
  const stored = await chrome.storage.local.get(queue.map((c) => cacheKey(c.id)));
  queue = queue.filter((card) => {
    const entry = stored[cacheKey(card.id)];
    if (!isFresh(entry)) return true;
    markLoaded(card, { providers: entry.providers, genres: entry.genres });
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
const kindActive = () => state.kindFilter && state.selectedKinds.size > 0;

// A film is shown when it passes every active filter.
function matches(card) {
  if (!state.enabled || !card.data) return true; // not loaded yet (or failed): keep visible rather than hide unknowns
  const { providers, genres, kind } = card.data;
  if (platformActive()) {
    const types = state.types.size ? [...state.types] : Object.keys(providers);
    if (!types.some((t) => (providers[t] || []).some((p) => state.selected.has(p)))) return false;
  }
  if (genreActive() && !genres.some((g) => state.selectedGenres.has(g))) return false;
  if (kindActive() && !state.selectedKinds.has(kind)) return false;
  return true;
}

const settings = () => ({
  enabled: state.enabled,
  platformFilter: state.platformFilter,
  selected: [...state.selected],
  types: [...state.types],
  genreFilter: state.genreFilter,
  selectedGenres: [...state.selectedGenres],
  kindFilter: state.kindFilter,
  selectedKinds: [...state.selectedKinds],
});

function applyFilter() {
  const filtering = state.enabled && (platformActive() || genreActive() || kindActive());
  for (const card of state.cards) {
    card.el.classList.toggle('fafx-hidden', !matches(card));
    card.el.classList.toggle('fafx-pending', filtering && !card.loaded); // dimmed until its data is known
  }
}

// ---- popup messaging -----------------------------------------------------

// The filter UI lives in the extension popup (src/popup/); it polls with 'get' and updates with 'set'.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'set') {
    state.enabled = msg.enabled;
    state.platformFilter = msg.platformFilter;
    state.selected = new Set(msg.selected);
    state.types = new Set(msg.types);
    state.genreFilter = msg.genreFilter;
    state.selectedGenres = new Set(msg.selectedGenres);
    state.kindFilter = msg.kindFilter;
    state.selectedKinds = new Set(msg.selectedKinds);
    applyFilter();
    chrome.storage.sync.set(settings());
    loadAll();
  }
  reply({
    ...settings(),
    platforms: [...state.platforms].sort(),
    genres: [...state.genres].sort(),
    done: state.done,
    total: state.cards.length,
  });
});

// ---- main ----------------------------------------------------------------

async function main() {
  if (/\/film\d+\.html/.test(location.pathname)) return; // single film page
  state.cards = findCards();
  if (state.cards.length < 2) return; // not a list page
  const saved = await chrome.storage.sync.get(['enabled', 'platformFilter', 'selected', 'types', 'genreFilter', 'selectedGenres', 'kindFilter', 'selectedKinds']);
  if (saved.enabled !== undefined) state.enabled = saved.enabled;
  if (saved.platformFilter !== undefined) state.platformFilter = saved.platformFilter;
  if (saved.selected) state.selected = new Set(saved.selected);
  if (saved.types) state.types = new Set(saved.types);
  if (saved.genreFilter !== undefined) state.genreFilter = saved.genreFilter;
  if (saved.selectedGenres) state.selectedGenres = new Set(saved.selectedGenres);
  if (saved.kindFilter !== undefined) state.kindFilter = saved.kindFilter;
  if (saved.selectedKinds) state.selectedKinds = new Set(saved.selectedKinds);
  // Saved platforms and genres must show up as options even before they are seen.
  state.selected.forEach((p) => state.platforms.add(p));
  state.selectedGenres.forEach((g) => state.genres.add(g));

  queue = [...state.cards];
  applyFilter();
  loadAll();
}

main();
