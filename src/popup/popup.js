// Popup UI: talks to the content script of the active tab (see "popup messaging" in src/content.js).
const TYPES = ['Suscripción', 'Alquiler', 'Compra'];
let tabId;
let current = { selected: [], types: [] };
let shownKey = '';

const $ = (id) => document.getElementById(id);

function send(msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => null); // null: no content script on this tab
}

function checkboxes(container, items, checked, onChange) {
  container.replaceChildren(...items.map((name) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked.includes(name);
    input.onchange = () => onChange(name, input.checked);
    label.append(input, ' ', name);
    return label;
  }));
}

function toggle(key) {
  return (name, on) => {
    const set = new Set(current[key]);
    on ? set.add(name) : set.delete(name);
    current[key] = [...set];
    send({ type: 'set', selected: current.selected, types: current.types });
  };
}

function render(s) {
  current = { selected: s.selected, types: s.types };
  // Rebuild the checkboxes only when the platform list changes, so clicks aren't lost while loading.
  const key = s.platforms.join('|');
  if (key !== shownKey) {
    shownKey = key;
    checkboxes($('types'), TYPES, s.types, toggle('types'));
    checkboxes($('platforms'), s.platforms, s.selected, toggle('selected'));
  }
  $('status').textContent = `Cargando disponibilidad: ${s.done}/${s.total} · Datos: JustWatch`;
}

async function poll() {
  const s = await send({ type: 'get' });
  $('msg').hidden = !!s;
  $('panel').hidden = !s;
  if (s) render(s);
}

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  tabId = tab.id;
  poll();
  setInterval(poll, 700);
});
