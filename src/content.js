// FilmAffinity Advanced Filters: filter list items by streaming platform.
// Flow: find film cards -> fetch each film page (throttled, cached) -> parse "Disponible en" -> filter.

const TTL_MS = 24 * 3600 * 1000;
const DELAY_MS = 400;

const state = {
  cards: [],            // { id, el, providers: {type: [platform]} | null }
  platforms: new Set(), // platforms seen so far
  selected: new Set(),  // platforms the user ticked
  types: new Set(),     // empty = any type of availability counts
  enabled: false,       // master switch (everything is off by default)
  platformFilter: false, // on/off for the platform filter (selection is kept while off)
  done: 0,
  loading: false,
};

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
    byId.set(m[1], { id: m[1], el, providers: null });
  }
  return [...byId.values()];
}

// ---- fetching + cache ----------------------------------------------------

async function getProviders(id) {
  const key = 'fa:' + id;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.t < TTL_MS) return cached.providers;

  const res = await fetch(`/${location.pathname.split('/')[1]}/film${id}.html`, { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const providers = parseProviders(doc);
  await chrome.storage.local.set({ [key]: { t: Date.now(), providers } });
  return providers;
}

// Fetches availability for every card not yet loaded. Stops while the extension is switched off.
async function loadAll() {
  if (state.loading) return;
  state.loading = true;
  for (const card of state.cards) {
    if (!state.enabled) break;
    if (card.loaded) continue;
    try {
      card.providers = await getProviders(card.id);
      for (const names of Object.values(card.providers)) names.forEach((n) => state.platforms.add(n));
    } catch (e) {
      console.warn('[fa-filter] film', card.id, e.message);
      if (String(e.message).includes('HTTP 429')) await sleep(10000); // back off if rate limited
    }
    card.loaded = true;
    state.done++;
    applyFilter();
    await sleep(DELAY_MS);
  }
  state.loading = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- filtering -----------------------------------------------------------

function matches(card) {
  if (!state.enabled || !state.platformFilter || state.selected.size === 0) return true;
  if (!card.providers) return true; // not loaded yet (or failed): keep visible rather than hide unknowns
  const types = state.types.size ? [...state.types] : Object.keys(card.providers);
  return types.some((t) => (card.providers[t] || []).some((p) => state.selected.has(p)));
}

const settings = () => ({
  enabled: state.enabled,
  platformFilter: state.platformFilter,
  selected: [...state.selected],
  types: [...state.types],
});

function applyFilter() {
  const filtering = state.enabled && state.platformFilter && state.selected.size > 0;
  for (const card of state.cards) {
    card.el.classList.toggle('fafx-hidden', !matches(card));
    card.el.classList.toggle('fafx-pending', filtering && !card.loaded); // dimmed until its availability is known
  }
  chrome.storage.sync.set(settings());
}

// ---- popup messaging -----------------------------------------------------

// The filter UI lives in the extension popup (src/popup/); it polls with 'get' and updates with 'set'.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'set') {
    state.enabled = msg.enabled;
    state.platformFilter = msg.platformFilter;
    state.selected = new Set(msg.selected);
    state.types = new Set(msg.types);
    applyFilter();
    if (state.enabled) loadAll();
  }
  reply({
    ...settings(),
    platforms: [...state.platforms].sort(),
    done: state.done,
    total: state.cards.length,
  });
});

// ---- main ----------------------------------------------------------------

async function main() {
  if (/\/film\d+\.html/.test(location.pathname)) return; // single film page
  state.cards = findCards();
  if (state.cards.length < 2) return; // not a list page
  const saved = await chrome.storage.sync.get(['enabled', 'platformFilter', 'selected', 'types']);
  if (saved.enabled !== undefined) state.enabled = saved.enabled;
  if (saved.platformFilter !== undefined) state.platformFilter = saved.platformFilter;
  if (saved.selected) state.selected = new Set(saved.selected);
  if (saved.types) state.types = new Set(saved.types);
  // Saved platforms must show up as options even before they are seen.
  state.selected.forEach((p) => state.platforms.add(p));

  applyFilter();
  loadAll();
}

main();
