// Popup UI: talks to the content script of the active tab (see "popup messaging" in src/content.js).
// Styling uses Tailwind classes; run `npm run build:css` after adding new classes.
const TYPES = ['Suscripción', 'Alquiler', 'Compra'];
const KINDS = ['Película', 'Serie', 'Miniserie'];
let tabId;
let s = null;          // last state received from the page
let renderedKey = '';
const DEFAULTS = { // same as src/content.js
  enabled: false,
  platformFilter: false, selected: [], types: [],
  genreFilter: false, selectedGenres: [],
  countryFilter: false, selectedCountries: [],
  kindFilter: false, selectedKinds: [],
  yearFilter: false, yearFrom: null, yearTo: null,
  durationFilter: false, maxDuration: null,
};

// The searchable lists. `query` is the search text, kept across re-renders.
const LISTS = {
  platform: { title: 'Plataformas', filter: 'platformFilter', items: 'platforms', sel: 'selected', prefix: 'p:',
              placeholder: 'Buscar plataforma…', loading: 'Buscando plataformas…', query: '' },
  genre: { title: 'Géneros', filter: 'genreFilter', items: 'genres', sel: 'selectedGenres', prefix: 'g:',
           placeholder: 'Buscar género…', loading: 'Buscando géneros…', query: '', hint: 'Basta con que tenga uno de los marcados.' },
  country: { title: 'País', filter: 'countryFilter', items: 'countries', sel: 'selectedCountries', prefix: 'c:',
             placeholder: 'Buscar país…', loading: 'Buscando países…', query: '' },
};

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.tabs.sendMessage(tabId, msg).catch(() => null); // null: no content script here

// Applies changes locally and sends the settings to the page, which applies and saves them.
// `delay` (ms) debounces the send while typing numbers; polling is paused until it is sent.
const stateKey = () => JSON.stringify([...Object.keys(DEFAULTS).map((k) => s[k]), s.platforms, s.genres, s.countries]);
let pushTimer = null;
let version = 0; // bumped on every local change, so a poll started before it can't overwrite it
function update(changes, delay = 0) {
  version++;
  s = { ...s, ...changes };
  renderedKey = stateKey(); // so the next poll doesn't re-render because of our own change
  if (delay) $('reset-wrap').innerHTML = resetHtml(); // typing: keep the input element untouched
  else render();
  clearTimeout(pushTimer);
  const push = () => {
    pushTimer = null;
    send({ type: 'set', ...Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, s[k]])) });
  };
  if (delay) pushTimer = setTimeout(push, delay);
  else push();
}

const flip = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

function switchHtml(id, on, label, disabled = false) {
  return `
    <button role="switch" aria-checked="${on}" aria-label="${label}" data-switch="${id}" ${disabled ? 'disabled' : ''}
      class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
             ${on ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'} ${disabled ? 'opacity-40' : 'cursor-pointer'}">
      <span class="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}"></span>
    </button>`;
}

function rowHtml(id, on, label, disabled) {
  return `
    <div class="flex items-center justify-between py-1.5 ${disabled ? 'opacity-50' : ''}">
      <span>${label}</span>${switchHtml(id, on, label, disabled)}
    </div>`;
}

const card = (inner) => `<section class="mb-3 break-inside-avoid rounded-xl bg-white dark:bg-slate-800 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 p-3">${inner}</section>`;
const title = (t) => `<h3 class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">${t}</h3>`;

const norm = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function listItemsHtml(l) {
  const filterOff = !s.enabled || !s[l.filter];
  if (!s[l.items].length) return `<p class="py-2 text-slate-500 dark:text-slate-400">${l.loading}</p>`;
  const shown = s[l.items].filter((x) => norm(x).includes(norm(l.query.trim())));
  if (!shown.length) return `<p class="py-2 text-slate-500 dark:text-slate-400">Sin resultados</p>`;
  return shown.map((x) => rowHtml(l.prefix + x, s[l.sel].includes(x), x, filterOff)).join('');
}

function listCardHtml(kind) {
  const l = LISTS[kind];
  return card(`
    <div class="flex items-center justify-between">
      ${title(l.title)}${switchHtml(l.filter, s[l.filter], 'Filtrar por ' + l.title.toLowerCase(), !s.enabled)}
    </div>
    ${l.hint ? `<p class="mt-1 text-xs text-slate-500 dark:text-slate-400">${l.hint}</p>` : ''}
    <input id="search-${kind}" data-kind="${kind}" type="search" placeholder="${l.placeholder}" value="${l.query.replace(/"/g, '&quot;')}"
      class="mt-2 w-full rounded-lg border-0 bg-slate-100 px-3 py-1.5 text-sm placeholder-slate-400 outline-none
             ring-1 ring-slate-200 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:ring-slate-600">
    <div id="list-${kind}" class="mt-1 max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/60">${listItemsHtml(l)}</div>`);
}

// A filter card with an on/off switch in its header, followed by `body`.
function filterCard(filter, heading, body, off) {
  return card(`
    <div class="flex items-center justify-between">
      ${title(heading)}${switchHtml(filter, s[filter], 'Filtrar por ' + heading.toLowerCase(), off)}
    </div>
    ${body}`);
}

function numberInput(key, label, off) {
  const disabled = off || !s[FILTER_OF[key]];
  return `
    <label class="flex flex-1 flex-col gap-1 text-xs text-slate-500 dark:text-slate-400 ${disabled ? 'opacity-50' : ''}">${label}
      <input id="num-${key}" data-num="${key}" type="number" min="0" value="${s[key] ?? ''}" ${disabled ? 'disabled' : ''}
        class="w-full rounded-lg border-0 bg-slate-100 px-3 py-1.5 text-sm text-slate-800 outline-none ring-1 ring-slate-200
               focus:ring-2 focus:ring-indigo-500 dark:bg-slate-700 dark:text-slate-100 dark:ring-slate-600">
    </label>`;
}
const FILTER_OF = { yearFrom: 'yearFilter', yearTo: 'yearFilter', maxDuration: 'durationFilter' };

const isDefault = () => Object.keys(DEFAULTS).every((k) => JSON.stringify(s[k]) === JSON.stringify(DEFAULTS[k]));

function resetHtml() {
  const d = isDefault();
  return `
    <button data-action="reset" ${d ? 'disabled' : ''}
      class="w-full rounded-lg px-3 py-2 text-sm font-medium ring-1 ring-slate-300 dark:ring-slate-600 transition
             ${d ? 'opacity-40' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800'}">
      Restablecer filtros
    </button>`;
}

function render() {
  // Re-rendering replaces the inputs; put the cursor back where it was.
  const focused = document.activeElement;
  const focusId = focused?.id;
  const caret = focused?.selectionStart;
  const off = !s.enabled;
  const filterOff = off || !s.platformFilter;

  $('panel').innerHTML = `
    <div class="p-3 space-y-3">
      <header class="flex items-center justify-between rounded-xl bg-indigo-500 px-4 py-3 text-white shadow">
        <div>
          <div class="font-semibold">FilmAffinity Filtros</div>
          <div class="text-xs text-indigo-100">${off ? 'Desactivado' : 'Activado'}</div>
        </div>
        <button role="switch" aria-checked="${!off}" aria-label="Activar extensión" data-switch="enabled"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${off ? 'bg-indigo-300' : 'bg-white/90'}">
          <span class="inline-block h-5 w-5 rounded-full shadow transition-transform ${off ? 'translate-x-0.5 bg-white' : 'translate-x-5 bg-indigo-500'}"></span>
        </button>
      </header>

      <div class="columns-2 gap-3">
      ${listCardHtml('platform')}

      ${card(`
        ${title('Tipo de disponibilidad')}
        <div class="mt-1 divide-y divide-slate-100 dark:divide-slate-700/60">
          ${TYPES.map((t) => rowHtml('t:' + t, s.types.includes(t), t, filterOff)).join('')}
        </div>`)}

      ${listCardHtml('genre')}

      ${listCardHtml('country')}

      ${filterCard('kindFilter', 'Formato', `
        <div class="mt-1 divide-y divide-slate-100 dark:divide-slate-700/60">
          ${KINDS.map((k) => rowHtml('k:' + k, s.selectedKinds.includes(k), k, off || !s.kindFilter)).join('')}
        </div>`, off)}

      ${filterCard('yearFilter', 'Año', `
        <div class="mt-2 flex gap-2">${numberInput('yearFrom', 'Desde', off)}${numberInput('yearTo', 'Hasta', off)}</div>`, off)}

      ${filterCard('durationFilter', 'Duración máxima', `
        <div class="mt-2 flex">${numberInput('maxDuration', 'Minutos', off)}</div>`, off)}
      </div>

      <div id="reset-wrap">${resetHtml()}</div>

      <footer id="status" class="px-1 text-xs text-slate-500 dark:text-slate-400"></footer>
    </div>`;
  renderStatus();
  if (focusId && $(focusId)) {
    $(focusId).focus();
    if (caret != null) try { $(focusId).setSelectionRange(caret, caret); } catch {} // number inputs have no selection
  }
}

function renderStatus() {
  const el = $('status');
  if (!el) return;
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  el.innerHTML = `
    <div class="mb-1 flex justify-between"><span>Disponibilidad ${s.done}/${s.total}</span><span>Datos: JustWatch</span></div>
    <div class="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
      <div class="h-full rounded-full bg-indigo-500 transition-all" style="width:${pct}%"></div>
    </div>`;
}

// Typing in a search box only re-renders its list; number inputs update the setting (debounced).
$('panel').addEventListener('input', (e) => {
  const key = e.target.dataset.num;
  if (key) return update({ [key]: e.target.value === '' ? null : Number(e.target.value) }, 300);
  const kind = e.target.dataset.kind;
  if (!kind) return;
  LISTS[kind].query = e.target.value;
  $('list-' + kind).innerHTML = listItemsHtml(LISTS[kind]);
});

// One click handler for every switch (the panel is re-rendered, so delegate from the container).
$('panel').addEventListener('click', (e) => {
  if (e.target.closest('[data-action="reset"]:not([disabled])')) return update(DEFAULTS);
  const btn = e.target.closest('[data-switch]');
  if (!btn || btn.disabled) return;
  const id = btn.dataset.switch;
  if (id === 'enabled') update({ enabled: !s.enabled });
  else if (id.endsWith('Filter')) update({ [id]: !s[id] });
  else if (id.startsWith('t:')) update({ types: flip(s.types, id.slice(2)) });
  else if (id.startsWith('k:')) update({ selectedKinds: flip(s.selectedKinds, id.slice(2)) });
  else {
    const l = Object.values(LISTS).find((x) => id.startsWith(x.prefix));
    if (l) update({ [l.sel]: flip(s[l.sel], id.slice(l.prefix.length)) });
  }
});

async function poll() {
  if (pushTimer) return; // unsent edits pending: don't overwrite them with the page's old state
  const v = version;
  const fresh = await send({ type: 'get' });
  if (pushTimer || v !== version) return;
  $('msg').hidden = !!fresh;
  $('panel').hidden = !fresh;
  if (!fresh) return;
  s = fresh;
  // Re-render everything only when something other than progress changed.
  const key = stateKey();
  if (key !== renderedKey) { renderedKey = key; render(); } else renderStatus();
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab.id;
  poll();
  setInterval(poll, 700);
});
