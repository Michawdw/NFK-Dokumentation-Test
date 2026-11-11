/* UI (ab v84.2) – reine Darstellung, keine Daten- oder Ablauflogik.
   - Hell/Dunkel-Umschalter in der Kopfleiste (Wahl nur auf diesem Gerät, localStorage).
   - Aktive Baustelle klein unter dem Titel der Kopfleiste.
   - Startseite: gespeicherte Stammdaten als kompakte Karte, Formular erst über „Bearbeiten".
   Aufgerufen wird UI.aktualisieren(job) aus App.renderSperre() – das läuft beim Laden der
   Startseite, nach dem Speichern der Stammdaten und bei jedem Auftragswechsel. */
const UI = (() => {
  const $ = (s) => document.querySelector(s);
  const KEY = 'nfk-theme';

  // ---------------------------------------------------------------- Hell / Dunkel
  const systemDunkel = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  function gespeichert() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  const aktuell = () => gespeichert() || (systemDunkel.matches ? 'dark' : 'light');

  function themeAnwenden() {
    const t = gespeichert();
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const dunkel = aktuell() === 'dark';
    // Statusleiste des Handys passend einfärben.
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute('content', dunkel ? '#17191e' : '#ffffff');
    });
    const btn = $('#themeBtn');
    if (btn) {
      btn.innerHTML = Icon(dunkel ? 'sun' : 'moon');
      const text = dunkel ? 'Helles Layout' : 'Dunkles Layout';
      btn.title = text;
      btn.setAttribute('aria-label', text);
    }
  }

  function themeWechseln() {
    const neu = aktuell() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, neu); } catch (e) { /* privater Modus: nur für diese Sitzung */ document.documentElement.dataset.theme = neu; }
    document.documentElement.classList.add('theme-wechsel');
    themeAnwenden();
    setTimeout(() => document.documentElement.classList.remove('theme-wechsel'), 250);
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
    if (btn) btn.onclick = themeWechseln;
    if (systemDunkel.addEventListener) systemDunkel.addEventListener('change', themeAnwenden);
    const f = $('#projectForm');
    if (f) f.addEventListener('submit', nachSpeichern, true);   // vor dem Speichern-Handler
  });

  return { aktualisieren };
})();
