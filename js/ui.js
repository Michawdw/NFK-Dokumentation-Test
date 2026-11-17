/* UI (ab v84.2) – reine Darstellung, keine Daten- oder Ablauflogik.
   - Hell/Dunkel-Umschalter in der Kopfleiste (Wahl nur auf diesem Gerät, localStorage).
   - Aktive Baustelle klein unter dem Titel der Kopfleiste.
   - Startseite: gespeicherte Stammdaten als kompakte Karte, Formular erst über „Bearbeiten".
   Aufgerufen wird UI.aktualisieren(job) aus App.renderSperre() – das läuft beim Laden der
   Startseite, nach dem Speichern der Stammdaten und bei jedem Auftragswechsel. */
// Bewegung (ab v84.13): Kurven und Dauern für Animationen aus JavaScript. Müssen zu den
// Tokens in css/styles.css (:root) passen: --ease, --ease-drawer, --ease-in-out, --dur-ui, --dur-fast.
const Bewegung = Object.freeze({
  EASE_OUT: 'cubic-bezier(0.23, 1, 0.32, 1)',      // = --ease
  EASE_DRAWER: 'cubic-bezier(0.32, 0.72, 0, 1)',   // = --ease-drawer
  EASE_IN_OUT: 'cubic-bezier(0.77, 0, 0.175, 1)',  // = --ease-in-out
  DUR: 200,                                        // = --dur-ui
  DUR_FAST: 150,                                   // = --dur-fast
});

const UI = (() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'nfk-theme';

  // ---------------------------------------------------------------- Hell / Dunkel / System
  // Wahl (ab v85): 'light' | 'dark' gespeichert, „System" = kein Eintrag (folgt dem Handy).
  // Gespeichert wird nur auf diesem Gerät (localStorage), wie bisher unter 'nfk-theme'.
  const systemDunkel = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const WAHLEN = [
    { wert: 'light', text: 'Hell', icon: 'sun' },
    { wert: 'dark', text: 'Dunkel', icon: 'moon' },
    { wert: 'system', text: 'System', icon: 'monitor' },
  ];
  let sitzungsWahl = null;   // privater Modus ohne localStorage: Wahl gilt nur für diese Sitzung
  function gespeichert() {
    try { return localStorage.getItem(KEY); } catch (e) { return sitzungsWahl; }
  }
  const wahl = () => { const t = gespeichert(); return t === 'light' || t === 'dark' ? t : 'system'; };

  function themeAnwenden() {
    const w = wahl();
    if (w === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = w;
    // Statusleiste des Handys in der Hintergrundfarbe der App einfärben (Token --bg).
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', bg));
    const btn = $('#themeBtn');
    if (btn) {
      const eintrag = WAHLEN.find((x) => x.wert === w);
      btn.innerHTML = Icon(eintrag.icon);
      const text = 'Layout: ' + eintrag.text;
      btn.title = text;
      btn.setAttribute('aria-label', text);
      btn.setAttribute('aria-haspopup', 'menu');
    }
    const menue = $('#themeMenue');
    if (menue) menue.querySelectorAll('[data-wahl]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.wahl === w)));
  }

  function themeSetzen(w) {
    if (w === wahl()) return;
    try {
      if (w === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, w);
    } catch (e) { sitzungsWahl = w === 'system' ? null : w; }
    document.documentElement.classList.add('theme-wechsel');
    themeAnwenden();
    setTimeout(() => document.documentElement.classList.remove('theme-wechsel'), 250);
  }

  // Kleines Auswahlmenü unter dem Knopf in der Kopfleiste.
  function menueBauen() {
    const m = document.createElement('div');
    m.id = 'themeMenue';
    m.className = 'theme-menue';
    m.setAttribute('role', 'menu');
    m.setAttribute('aria-label', 'Layout');
    m.hidden = true;
    m.innerHTML = '<div class="theme-menue-titel">Layout</div>' + WAHLEN.map((x) =>
      `<button type="button" role="menuitemradio" class="theme-wahl" data-wahl="${x.wert}">${Icon(x.icon)}<span>${x.text}</span>${Icon('check', 'theme-haken')}</button>`).join('');
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wahl]');
      if (!b) return;
      themeSetzen(b.dataset.wahl);
      menueZu();
    });
    document.body.appendChild(m);
    return m;
  }
  function menueOffen() { const m = $('#themeMenue'); return !!(m && !m.hidden); }
  function menueAuf() {
    const m = $('#themeMenue') || menueBauen();
    const btn = $('#themeBtn');
    themeAnwenden();
    const r = btn.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + 6) + 'px';
    m.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + 'px';
    m.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const aktiv = m.querySelector('[aria-checked="true"]');
    if (aktiv) aktiv.focus({ preventScroll: true });
  }
  function menueZu() {
    const m = $('#themeMenue');
    if (!m || m.hidden) return;
    m.hidden = true;
    const btn = $('#themeBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  // ---------------------------------------------------------------- Kopfleiste
  function baustelleZeigen(job) {
    const el = $('#topSub');
    if (!el) return;
    const h = (job && job.header) || {};
    const text = h.filiale ? (h.ort && !h.filiale.includes(h.ort) ? `${h.filiale} · ${h.ort}` : h.filiale) : '';
    el.textContent = text;
    el.hidden = !text;
  }

  // ---------------------------------------------------------------- Stammdaten-Karte
  let bearbeiten = false;
  let letzterJob = null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const datumText = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso || '');
  };

  function stammdatenZeigen(job) {
    const block = $('#stammdatenBlock'), karte = $('#stammKarte');
    if (!block || !karte) return;
    if (job !== letzterJob) { bearbeiten = false; letzterJob = job; }
    const h = (job && job.header) || {};
    const vollstaendig = !!(String(h.filiale || '').trim() && String(h.ort || '').trim() && h.datum);
    const kompakt = vollstaendig && !bearbeiten;
    block.classList.toggle('kompakt', kompakt);
    karte.hidden = !vollstaendig;
    if (!vollstaendig) return;
    karte.innerHTML = `
      <div class="sk-main">
        <div class="sk-titel">${esc(h.filiale)}</div>
        <div class="sk-meta">
          <span>${Icon('map-pin', 'i-sm')} ${esc(h.ort)}</span>
          <span>${Icon('calendar-days', 'i-sm')} ${esc(datumText(h.datum))}</span>
          <span>${Icon('briefcase', 'i-sm')} ${esc(h.beauftragung || 'NFK Vollverkabelung')}</span>
        </div>
      </div>
      <button type="button" class="btn ghost sk-edit">${Icon(bearbeiten ? 'x' : 'pencil')} ${bearbeiten ? 'Schließen' : 'Bearbeiten'}</button>`;
    karte.querySelector('.sk-edit').onclick = () => {
      bearbeiten = !bearbeiten;
      if (!bearbeiten) {
        // Nicht gespeicherte Eingaben verwerfen – das Formular zeigt wieder den gespeicherten Stand.
        const f = $('#projectForm');
        if (f) {
          f.filiale.value = h.filiale || '';
          f.ort.value = h.ort || '';
          f.datum.value = h.datum || '';
          f.beauftragung.value = h.beauftragung || 'NFK Vollverkabelung';
        }
      }
      stammdatenZeigen(job);
      if (bearbeiten) { const f = $('#projectForm'); if (f) f.filiale.focus({ preventScroll: true }); }
    };
  }

  // Nach dem Speichern: Formular wieder zur Karte zusammenklappen.
  function nachSpeichern() { bearbeiten = false; }

  function aktualisieren(job) {
    baustelleZeigen(job);
    stammdatenZeigen(job);
  }

  document.addEventListener('DOMContentLoaded', () => {
    themeAnwenden();
    const btn = $('#themeBtn');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.onclick = (e) => { e.stopPropagation(); if (menueOffen()) menueZu(); else menueAuf(); };
    }
    // Schließen: Tipp daneben, Esc, Scrollen, Drehen des Handys.
    document.addEventListener('click', (e) => { if (menueOffen() && !e.target.closest('#themeMenue')) menueZu(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menueOffen()) { menueZu(); if (btn) btn.focus(); } });
    window.addEventListener('scroll', menueZu, { passive: true });
    window.addEventListener('resize', menueZu);
    if (systemDunkel.addEventListener) systemDunkel.addEventListener('change', themeAnwenden);
    const f = $('#projectForm');
    if (f) f.addEventListener('submit', nachSpeichern, true);   // vor dem Speichern-Handler
  });

  return { aktualisieren };
})();
