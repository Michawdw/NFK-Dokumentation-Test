/* namen.js – Namensauswahl für Techniker-Felder (Bautagebuch, Wochenbericht-Gesprächspartner).
   Ein Feld für beides: Antippen öffnet darunter die Liste, Tippen filtert, ein unbekannter Name
   wird einfach ausgeschrieben und auf diesem Gerät gemerkt.

   Quellen:
     - assets/technikerliste.xlsx (erstes Blatt, Spalte A, Kopfzeile „Techniker“ wird übersprungen).
       Zum Aktualisieren nur die Datei austauschen – sw.js lädt sie network-first.
     - eigene Namen: DB.getMeta('eigeneNamen') – nur dieses Gerät, mit ✎ markiert, per ✕ löschbar.

   Benutzung:  Namen.anbinden(input, { ausblenden: () => ['Name', …] })
   Das <input> bleibt das eigentliche Feld; Speichern/Autosave laufen unverändert über dessen Wert.
*/
const Namen = (() => {
  const DATEI = 'assets/technikerliste.xlsx';
  const META = 'eigeneNamen';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const key = (s) => norm(s).toLowerCase();

  let _liste = null;        // Promise<string[]> der Technikerliste (einmal je Sitzung)
  let _eigene = null;       // string[]

  async function technikerliste() {
    if (!_liste) {
      _liste = (async () => {
        try {
          const res = await fetch(DATEI);
          if (!res.ok) return [];
          await Structure.loadExcelJS();
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(await res.arrayBuffer());
          const ws = wb.worksheets[0];
          if (!ws) return [];
          const out = [], gesehen = new Set();
          ws.eachRow((row, nr) => {
            const v = row.getCell(1).value;
            const t = norm(v && typeof v === 'object' ? (v.text || v.result || '') : v);
            if (!t || (nr === 1 && /^techniker/i.test(t)) || gesehen.has(key(t))) return;
            gesehen.add(key(t));
            out.push(t);
          });
          return out;
        } catch (e) {
          console.warn('Technikerliste nicht lesbar:', e);
          _liste = null;              // beim nächsten Mal erneut versuchen
          return [];
        }
      })();
    }
    return _liste;
  }

  async function eigene() {
    if (!_eigene) {
      try { _eigene = (await DB.getMeta(META)) || []; } catch (e) { _eigene = []; }
    }
    return _eigene;
  }

  // Technikerliste + eigene Namen, alphabetisch. [{ name, eigen }]
  async function alle() {
    const [t, e] = await Promise.all([technikerliste(), eigene()]);
    const bekannt = new Set(t.map(key));
    const liste = t.map((name) => ({ name, eigen: false }))
      .concat(e.filter((n) => !bekannt.has(key(n))).map((name) => ({ name, eigen: true })));
    return liste.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  }

  async function merken(name) {
    const n = norm(name);
    if (!n) return;
    const t = await technikerliste();
    const e = await eigene();
    if (t.concat(e).some((x) => key(x) === key(n))) return;
    _eigene = e.concat(n);
    await DB.setMeta(META, _eigene);
  }

  async function vergessen(name) {
    const e = await eigene();
    _eigene = e.filter((x) => key(x) !== key(name));
    await DB.setMeta(META, _eigene);
  }

  // ----------------------------------------------------------------- Auswahlfeld
  function anbinden(input, opts) {
    if (!input || input.dataset.namen) return;
    input.dataset.namen = '1';
    const o = opts || {};
    input.setAttribute('autocomplete', 'off');

    const box = document.createElement('span');
    box.className = 'namen-box';
    input.parentNode.insertBefore(box, input);
    const zeile = document.createElement('span');     // Feld + ▾ (Knopf genau so hoch wie das Feld)
    zeile.className = 'namen-zeile';
    box.appendChild(zeile);
    zeile.appendChild(input);
    const pfeil = document.createElement('button');
    pfeil.type = 'button';
    pfeil.className = 'namen-pfeil';
    pfeil.tabIndex = -1;
    pfeil.setAttribute('aria-label', 'Namensliste öffnen');
    pfeil.textContent = '▾';
    zeile.appendChild(pfeil);
    const liste = document.createElement('div');
    liste.className = 'namen-liste';
    liste.hidden = true;
    box.appendChild(liste);

    let offen = false;
    let stumm = false;          // eigene Ereignisse beim Übernehmen öffnen die Liste nicht wieder
    const setzen = (wert) => {
      input.value = wert;
      stumm = true;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      stumm = false;
    };

    let lauf = 0;               // jüngster Aufruf gewinnt; Schließen verwirft laufende
    async function zeigen() {
      const mein = ++lauf;
      const text = key(input.value);
      const weg = new Set((o.ausblenden ? o.ausblenden() : []).map(key).filter(Boolean));
      const treffer = (await alle()).filter((x) => !weg.has(key(x.name))
        && (!text || key(x.name).includes(text)));
      const exakt = (await alle()).some((x) => key(x.name) === text);
      if (mein !== lauf) return;
      let html = treffer.map((x) => `<div class="namen-eintrag${x.eigen ? ' eigen' : ''}" data-name="${esc(x.name)}">
          <span class="namen-text">${x.eigen ? '✎ ' : ''}${esc(x.name)}</span>
          ${x.eigen ? '<button type="button" class="namen-del" tabindex="-1" aria-label="Namen aus der Liste entfernen">✕</button>' : ''}
        </div>`).join('');
      if (text && !exakt) {
        html += `<div class="namen-eintrag namen-neu" data-neu="${esc(norm(input.value))}">+ „${esc(norm(input.value))}“ als neuen Namen</div>`;
      }
      if (!html) html = '<div class="namen-leer">Keine Namen in der Liste – einfach eintippen.</div>';
      liste.innerHTML = html;
      liste.hidden = false;
      offen = true;
    }
    function schliessen() {
      lauf++;
      liste.hidden = true;
      offen = false;
    }

    input.addEventListener('focus', zeigen);
    input.addEventListener('input', () => { if (!stumm && document.activeElement === input) zeigen(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliessen(); });
    // Unbekannter Name, ohne die Liste zu benutzen: beim Verlassen merken.
    input.addEventListener('change', () => { if (norm(input.value)) merken(input.value); });
    pfeil.addEventListener('click', () => {
      if (offen) { schliessen(); return; }
      input.focus();
      zeigen();
    });
    // Tippen in der Liste darf dem Feld den Fokus nicht nehmen (sonst schließt sie vorher).
    liste.addEventListener('mousedown', (e) => e.preventDefault());
    liste.addEventListener('click', async (e) => {
      // Steht das Feld in einem <label> (Wochenbericht), würde der Klick sonst den Fokus ins
      // Feld zurückholen und die Liste sofort wieder öffnen.
      e.preventDefault();
      const del = e.target.closest('.namen-del');
      const eintrag = e.target.closest('.namen-eintrag');
      if (!eintrag) return;
      if (del) {
        const name = eintrag.dataset.name;
        const ok = await App.openConfirm('Namen aus der Liste entfernen?',
          `<p>„${esc(name)}“ wird aus der Namensliste dieses Handys entfernt. Bereits gespeicherte
             Einträge bleiben unverändert.</p>`, 'Entfernen', true);
        if (ok) await vergessen(name);
        input.focus();
        zeigen();
        return;
      }
      if (eintrag.dataset.neu) {
        await merken(eintrag.dataset.neu);
        setzen(eintrag.dataset.neu);
      } else {
        setzen(eintrag.dataset.name);
      }
      schliessen();
      input.blur();
    });
    box.addEventListener('focusout', () => {
      setTimeout(() => { if (!box.contains(document.activeElement)) schliessen(); }, 150);
    });
  }

  return { anbinden, alle, merken, vergessen, technikerliste };
})();
