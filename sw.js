/* Service Worker – Precache der App-Shell für vollständigen Offline-Betrieb.
   Cache-Version bei jeder Änderung der Asset-Liste erhöhen. */
const CACHE = 'nfk-doku-v61';
const TEILEN_CACHE = 'nfk-teilen';   // geteilte Datei bis zur Abholung durch die App

const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/datum.js',
  './js/db.js',
  './js/app.js',
  './js/template.js',
  './js/photos.js',
  './js/overview.js',
  './js/export-zip.js',
  './js/bautagebuch.js',
  './js/handover.js',
  './js/merge.js',
  './js/docx.js',
  './js/protokoll.js',
  './js/behinderung.js',
  './js/vorpruefung.js',
  './js/wochenbericht.js',
  './lib/jszip.min.js',
  './lib/exceljs.min.js',
  './manifest.webmanifest',
  './assets/vorlage_bautagebuch.xlsx',
  './assets/templates.xlsx',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/logo.png'
];

self.addEventListener('install', (event) => {
  // Einzeln cachen statt addAll: ein einzelnes fehlendes Asset darf die
  // Installation nicht abbrechen lassen (sonst bleibt eine alte Version aktiv).
  // WICHTIG: fetch mit cache:'reload' statt cache.add – sonst darf der Browser die
  // Dateien aus seinem eigenen HTTP-Cache liefern und eine neue Version cacht
  // versehentlich wieder die ALTEN Dateien ein.
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => {
            if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
            return cache.put(url, res);
          })
          .catch((e) => console.warn('Precache übersprungen:', url, e))
      ))
    ).then(() => self.skipWaiting())
  );
});

// Version auf Anfrage der Seite zurückmelden (für die Versionsanzeige auf der Startseite).
self.addEventListener('message', (event) => {
  if (event.data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: CACHE });
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE && k !== TEILEN_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Teilen-Ziel (manifest share_target): Android schickt die in WhatsApp & Co. geteilte Datei
  // als POST hierher. Datei zwischenlagern und die App öffnen – app.js holt sie dort ab
  // (geteiltAbholen). Ein eigener Cache, damit ein Versionswechsel sie nicht wegräumt.
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/teilen')) {
    event.respondWith((async () => {
      try {
        const form = await req.formData();
        const datei = form.getAll('datei').find((f) => f && typeof f !== 'string');
        if (datei) {
          const c = await caches.open(TEILEN_CACHE);
          await c.put('./geteilt', new Response(datei, { headers: {
            'Content-Type': datei.type || 'application/octet-stream',
            'X-Dateiname': encodeURIComponent(datei.name || 'Datei'),
          } }));
        }
      } catch (e) {
        console.warn('Geteilte Datei nicht übernommen:', e);
      }
      return Response.redirect('./index.html?geteilt=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Seitenaufrufe (Navigation) IMMER zuverlässig bedienen: zuerst index.html aus
  // dem Cache, damit die App auch offline und im installierten Modus sicher startet.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html')
        .then((cached) => cached || fetch(req))
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Vorlagen-Sammlung: network-first, damit neu hochgeladene Tabs sofort erscheinen;
  // offline Fallback auf die zwischengespeicherte Datei.
  if (req.url.indexOf('assets/templates.xlsx') !== -1) {
    event.respondWith(
      fetch(req.url, { cache: 'reload' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            // waitUntil: ohne das kann der Service Worker beendet werden, bevor der
            // Cache-Eintrag geschrieben ist – die Vorlage fehlte dann offline.
            event.waitUntil(caches.open(CACHE).then((c) => c.put('./assets/templates.xlsx', copy)));
          }
          return res;
        })
        .catch(() => caches.match('./assets/templates.xlsx'))
    );
    return;
  }

  // Übrige Assets: Cache-first, sonst Netzwerk (und nachcachen).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(req, copy)));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
