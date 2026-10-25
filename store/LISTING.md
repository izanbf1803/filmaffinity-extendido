# Chrome Web Store listing (texts to paste into the dashboard)

## Store listing tab

**Name:** Filmaffinity extendido
(Short summary / manifest description is read from `manifest.json`; the dashboard also asks for a summary:)

**Summary (max 132 chars):**
Filtra tus listas y rankings de Filmaffinity por plataforma, género, país, año y duración, y muestra dónde ver cada película.

**Category:** Entertainment (Entretenimiento)   **Language:** Spanish

**Description:**
Filmaffinity extendido añade filtros avanzados y más información a tus listas y a los rankings de Filmaffinity, sin tener que abrir las películas una por una.

• Filtra por plataforma de streaming (suscripción, alquiler o compra).
• Filtra por género (basta con que tenga uno de los elegidos), país, formato (película, serie, miniserie), rango de años y duración máxima.
• Cada película muestra su duración y los logos de las plataformas donde está incluida en suscripción.
• Cada filtro se activa y desactiva por separado, y tus ajustes se recuerdan. Un botón los restablece todos.
• Todo empieza desactivado: la extensión no hace nada hasta que la activas.

Cómo se usa: abre una de tus listas o un ranking en filmaffinity.com, haz clic en el icono de la extensión y activa los filtros que quieras.

Privacidad: no recoge ni envía datos a nadie. Solo consulta filmaffinity.com con tu propia sesión y guarda tus ajustes y una caché de un día en tu navegador. La disponibilidad en plataformas la ofrece Filmaffinity (datos de JustWatch).

Esta extensión no está afiliada a Filmaffinity ni a JustWatch. Filmaffinity es una marca de sus propietarios.

**Graphics:** icon `icons/icon128.png`; screenshots `store/screenshots/*.png` (1280x800); small promo tile `store/promo-small-440x280.png`.

**Privacy policy URL:** https://github.com/izanbf1803/filmaffinity-extendido/blob/master/PRIVACY.md
(the repo must be public for this link to work)

## Privacy practices tab

**Single purpose:** Filtrar y enriquecer con información (plataformas, duración) las listas y rankings de películas de Filmaffinity.

**Permission justifications**
- `storage`: guardar los ajustes de los filtros y una caché de un día de los datos de las películas.
- Host access `https://www.filmaffinity.com/*` (content script): leer las listas/rankings para ocultar las películas que no cumplen los filtros, y cargar las fichas de las películas (mismo sitio) para obtener plataformas, géneros, país, año y duración.

**Remote code:** No, I am not using remote code. (All code is in the package; the only requests are page loads on filmaffinity.com.)

**Data usage:** do not check any "collected data" category. Certify: no sale of data, no use unrelated to the single purpose, no creditworthiness/lending use.
