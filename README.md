# FilmAffinity Advanced Filters

A Chrome extension that adds a filter panel (opened from the toolbar icon) for your [FilmAffinity](https://www.filmaffinity.com/es/main.html) lists, so you can show only the films available on the streaming platforms you choose. Goals and design notes are in [PROJECT.md](PROJECT.md).

## Requirements

- Google Chrome (or any Chromium browser with Manifest V3 support: Edge, Brave, ...).
- A FilmAffinity account with at least one list.

There is no build step, no dependencies and no API key.

## Setup

1. Get the code: clone or download this repository, so you have the folder containing `manifest.json`.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right switch).
4. Click **Load unpacked** and select this project folder.
5. The extension "FilmAffinity Advanced Filters" now appears in the list. Pin it so its icon is always in the toolbar.

## Usage

1. Log in to filmaffinity.com and open one of your lists.
2. Click the extension icon in the toolbar (pin it from the puzzle-piece menu). The popup lists the platforms found so far; it fills in as the extension reads each film's page (about 2-3 films per second), with a `done/total` counter.
3. Tick the platforms you want. Only films available on at least one ticked platform stay visible. With no platform ticked, everything is shown.
4. Use the **Tipo** checkboxes to choose which kind of availability counts: Suscripción (default), Alquiler or Compra.

Your choices are remembered between visits. Availability data is cached for 1 day, so reopening a list is fast.

## Updating after code changes

Go to `chrome://extensions` and click the reload icon on the extension card, then refresh the FilmAffinity tab.

## Troubleshooting

- **Popup says "Abre una lista":** the extension only activates on pages with 2 or more film links, and not on single film pages. If you just reloaded the extension, refresh the FilmAffinity tab too.
- **Wrong cards hidden, or none hidden:** the extension hides `li.list-row` on lists (and falls back to `.movie-card`, `li` or `tr` elsewhere). Adjust `LIST_ROW` / `FALLBACK_CARD` in `src/content.js` to match the list's markup (inspect a film entry in DevTools).
- **No platforms found:** open DevTools on a film page and run
  `fetch(location.href).then(r=>r.text()).then(t=>console.log(t.includes('stream-wrapper')))`.
  If it prints `false`, the "Disponible en" block is added by JavaScript and this approach needs changing.
- **Slow or stalls on long lists:** FilmAffinity may rate-limit requests. Check the DevTools console for `[fa-filter]` warnings; the extension waits 10 seconds after an HTTP 429. You can raise `DELAY_MS` in `src/content.js`.
- **Reset the cache:** remove and re-add the extension (the cache lives in its own storage), or lower `TTL_MS` in `src/content.js`.

## Project layout

```
manifest.json      Manifest V3 definition
src/content.js     card detection, film page fetching/parsing, filtering
src/content.css    hidden-card style
src/popup/        filter panel shown when clicking the extension icon
PROJECT.md         objectives, research and roadmap
```

## Data and privacy

The extension only talks to filmaffinity.com, using your existing session. Availability data comes from FilmAffinity's own "Disponible en" section, which is provided by JustWatch (credited in the popup). Nothing is sent anywhere else.
