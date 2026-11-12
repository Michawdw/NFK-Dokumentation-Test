/* app.js – Bootstrap, Navigation, Projektkopf, Bilddoku-Tree, Bautagebuch-Formular,
   sowie gemeinsame Helfer (Modal, Toast, Datei-Weitergabe). */
const App = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  let currentJob = null;    // aktiver Auftrag (im Speicher gehalten)
  let activeUrls = [];      // Object-URLs der Thumbnails (für Revoke)
  let currentNode = null;   // Knoten für die nächste Foto-Auswahl

  // Zugriff für andere Module (Structure/Photos/Overview/ExportZip/Handover).
  function getCurrentJob() { return currentJob; }
  async function saveCurrentJob() { if (currentJob) await DB.saveJob(currentJob); }

  // ---------------------------------------------------------------- Navigation
  const viewTitles = {
    'view-start': 'NFK Doku',
    'view-vorpruefung': 'Vorprüfung',
    'view-bilddoku': 'Bilddokumentation',
    'view-bautagebuch': 'Bautagebuch',
    'view-behinderung': 'Baubehinderungsanzeige',
    'view-wochenbericht': 'Wochenbericht',
  };

  let aktiveView = 'view-start';
  // zurueck: kommt vom Zurück-Pfeil/Android-Zurück – die Ansicht gleitet dann von links herein.
  function _switchView(viewId, zurueck) {
    const vorher = aktiveView;
    // Offene Eingaben beim Verlassen sichern (Zurück-Pfeil, Android-Zurück, Funktionswechsel).
    if (aktiveView === 'view-bautagebuch' && viewId !== 'view-bautagebuch') flushDiary();
    if (aktiveView === 'view-vorpruefung' && viewId !== 'view-vorpruefung') Vorpruefung.flush();
    if (aktiveView === 'view-wochenbericht' && viewId !== 'view-wochenbericht') Wochenbericht.flush();
    // Zurück auf die Startseite: „Weitere Aufträge" wieder zuklappen.
    if (viewId === 'view-start' && aktiveView !== 'view-start' && weitereOffen) {
      weitereOffen = false;
      renderJobList();
    }
    aktiveView = viewId;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === viewId));
    if (vorher !== viewId) animiereView($('#' + viewId), zurueck || viewId === 'view-start');
    $('#topTitle').textContent = viewTitles[viewId] || 'NFK Doku';
    $('#backBtn').hidden = (viewId === 'view-start');
    window.scrollTo(0, 0);
    if (viewId === 'view-start') { renderVpStatus(); renderBackupReminder('#backupReminderStart'); }
    if (viewId === 'view-vorpruefung') Vorpruefung.enter();
    if (viewId === 'view-bilddoku') enterBilddoku();
    if (viewId === 'view-bautagebuch') initDiaryView();
    if (viewId === 'view-behinderung') Behinderung.enter();
    if (viewId === 'view-wochenbericht') Wochenbericht.enter();
  }

  function animiereView(view, zurueck) {
    if (!view) return;               // bei „Bewegung reduzieren“ macht CSS daraus eine Überblendung
    view.classList.remove('enter-fwd', 'enter-back', 'view-start-anim');
    void view.offsetWidth;            // Animation auch bei schnellem Hin und Her neu starten
    view.classList.add(zurueck ? 'enter-back' : 'enter-fwd');
    // Startseite: Funktionskacheln nacheinander einblenden.
    if (view.id === 'view-start') view.classList.add('view-start-anim');
    clearTimeout(view._animEnde);
    view._animEnde = setTimeout(() => view.classList.remove('enter-fwd', 'enter-back', 'view-start-anim'), 700);
  }

  // Zugang zu Bilddoku/Bautagebuch erst, wenn die Vorprüfung des Auftrags vollständig
  // beantwortet ist. Andernfalls zur Vorprüfung springen und offene Punkte markieren.
  // Die Baubehinderungsanzeige ist bewusst NICHT gesperrt: eine Behinderung tritt oft
  // schon beim Antreffen der Baustelle auf, also vor Abschluss der Vorprüfung.
  // Vorher aber – für ALLE Arbeitsbereiche einschließlich Vorprüfung und
  // Baubehinderungsanzeige – vollständig gespeicherte Stammdaten: sonst entstehen Fotos und
  // Einträge ohne Filiale, und ZIP-Name, Übergabe und Filial-Warnung laufen ins Leere.
  function goGuard(target) {
    if (target !== 'view-start' && fehlendeStammdaten(currentJob).length) {
      stammdatenAnmahnen();
      return;
    }
    if ((target === 'view-bilddoku' || target === 'view-bautagebuch')
        && !Vorpruefung.entfaellt(currentJob) && Vorpruefung.isIncomplete(currentJob)) {
      show('view-vorpruefung');
      Vorpruefung.flagMissing();
      toast('Bitte zuerst die Vorprüfung vollständig beantworten.');
      return;
    }
    show(target);
  }

  // Navigiert zur Ansicht und legt für Unteransichten einen History-Eintrag an,
  // damit der Android-Zurück-Button dieselbe Wirkung hat wie der In-App-Pfeil.
  function show(viewId) {
    if (viewId !== 'view-start') history.pushState({ nfk: viewId }, '');
    _switchView(viewId);
  }

  // ------------------------------------------------------------------ Bewegung
  // Dezente Animationen (siehe „Bewegung & Tiefe" in styles.css). Wer am Handy
  // „Bewegung reduzieren" eingestellt hat, bekommt alles sofort und ohne Animation.
  const reduceMotion = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const DUR = 200, DUR_FAST = 150;
  const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';   // = --ease in styles.css
  // Scroll-Verhalten: weich, außer bei „Bewegung reduzieren“.
  const sanft = () => (reduceMotion.matches ? 'auto' : 'smooth');
  const ohneAnimation = (el) => !el || reduceMotion.matches || typeof el.animate !== 'function';
  // Lange Inhalte (Ordner mit vielen Bildern) werden nur über den sichtbaren Teil animiert:
  // Was unterhalb des Bildschirmrands liegt, sieht ohnehin niemand – so bleibt die
  // Animation auch auf alten Handys kurz und ruckelfrei, egal wie lang der Ordner ist.
  // obenBei: Bildschirmhöhe, an der der Inhalt nach einem gleichzeitigen Scrollen beginnt
  // (sonst die aktuelle Lage) – dann wird über den am Ende sichtbaren Teil animiert.
  function sichtbareHoehe(el, h, obenBei) {
    const top = obenBei != null ? obenBei : el.getBoundingClientRect().top;
    const rest = window.innerHeight - top + 40;
    return Math.min(h, Math.max(120, rest));
  }

  // Aufklappen: Höhe 0 → natürliche Höhe. Das Element steht bereits fertig im DOM.
  function animOpen(el, obenBei) {
    // „Bewegung reduzieren": keine Höhen-Bewegung, nur kurz einblenden.
    if (el && reduceMotion.matches && typeof el.animate === 'function') {
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    if (ohneAnimation(el)) return;
    const h = el.offsetHeight;
    if (!h) return;
    const ziel = sichtbareHoehe(el, h, obenBei);
    const cs = getComputedStyle(el);
    el.style.overflow = 'hidden';
    const a = el.animate([
      { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      { height: ziel + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
    ], { duration: DUR, easing: EASE });
    beiEnde(a, DUR, () => { el.style.overflow = ''; });
  }

  // Ruft fertig() genau einmal auf, wenn die Animation endet. Läuft die Seite gerade ohne
  // Bildaufbau (App im Hintergrund), bleibt eine Animation stehen und meldet ihr Ende nie –
  // der Ordner bliebe zusammengeklappt. Deshalb spätestens kurz danach von selbst.
  function beiEnde(a, dauer, fertig) {
    let erledigt = false;
    const ende = () => { if (!erledigt) { erledigt = true; fertig(); } };
    a.onfinish = a.oncancel = ende;
    setTimeout(() => {
      // Nur eine noch laufende Animation beenden – eine abgebrochene würde finish() sonst
      // wieder auf ihren Endzustand setzen (Höhe 0) und dort festhalten.
      if (a.playState === 'running') { try { a.finish(); } catch (e) { /* egal */ } }
      ende();
    }, dauer + 200);
  }

  // Zuklappen: Promise, das nach der Animation auflöst – erst danach wird neu gezeichnet.
  function animClose(el) {
    return new Promise((resolve) => {
      if (ohneAnimation(el) || !el.isConnected) { resolve(); return; }
      if (el.getAnimations) el.getAnimations().forEach((x) => x.finish());   // Aufklappen noch im Gange
      const h = el.offsetHeight;
      if (!h) { resolve(); return; }
      const start = sichtbareHoehe(el, h);
      const cs = getComputedStyle(el);
      el.style.overflow = 'hidden';
      const a = el.animate([
        { height: start + 'px', paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 1 },
        { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 },
      ], { duration: DUR_FAST + 30, easing: EASE, fill: 'forwards' });   // kein ease-in: Reaktion sofort sichtbar
      beiEnde(a, DUR_FAST + 30, resolve);
    });
  }

  // Overlays (Dialog, Bild-Großansicht): Ein-/Ausblenden übernimmt js/sheet.js – immer vom
  // aktuellen Stand aus. Schließen blendet erst aus und setzt dann hidden. Öffnet
  // währenddessen schon der nächste Dialog (Rückfrage direkt nach der vorigen), kehrt die
  // Bewegung einfach um; das abgelöste Schließen meldet sich dann nicht mehr (kein hidden).
  function openOverlay(o) {
    const warVersteckt = o.hidden;
    o._zu = null;
    o.hidden = false;
    Sheet.zeigen(o, warVersteckt);
  }
  function closeOverlay(o, danach) {
    if (o.hidden) {
      if (danach) danach();
      return;
    }
    const auftrag = {};
    o._zu = auftrag;
    Sheet.verbergen(o, () => {
      if (o._zu !== auftrag) return;      // inzwischen wieder geöffnet
      o._zu = null;
      o.hidden = true;
      if (danach) danach();
    });
  }

  // Lade-Anzeige für Knöpfe mit längerer Arbeit (Export): Kringel am Knopf, gegen
  // Doppel-Tippen gesperrt. Bewusst ohne disabled – das setzen manche Module selbst
  // (z. B. Protokoll erst nach „abschließen"), und das darf hier nicht überschrieben werden.
  function busy(fn) {
    return async function (e) {
      const btn = e && e.currentTarget;
      if (btn && btn.classList.contains('is-busy')) return;
      if (btn && btn.classList) btn.classList.add('is-busy');
      try { return await fn.apply(this, arguments); }
      finally { if (btn && btn.classList) btn.classList.remove('is-busy'); }
    };
  }

  // „✓ erledigt"-Haken kurz aufspringen lassen.
  function pop(el) {
    if (!el) return;                 // bei „Bewegung reduzieren“ nur Einblenden (CSS)
    el.classList.remove('pop');
    void el.offsetWidth;            // Animation neu starten
    el.classList.add('pop');
  }

  // ------------------------------------------------------------------- Helpers
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    clearTimeout(t._timer);
    // Ein- und Ausblenden per CSS-Transition (.zeigen): eine neue Meldung während des
    // Ausblendens kehrt die Bewegung vom aktuellen Stand aus um.
    if (t.hidden) { t.hidden = false; void t.offsetWidth; }
    t.classList.add('zeigen');
    t._timer = setTimeout(() => {
      t.classList.remove('zeigen');
      t._timer = setTimeout(() => { t.hidden = true; }, 250);
    }, ms);
  }
  // Eine laufende Meldung („Führe Bilder zusammen…") darf nicht über einer Rückfrage stehen –
  // sie verdeckte unten die Knöpfe und klang, als liefe der Import schon. Rückfrage-Dialoge
  // blenden sie deshalb aus.
  function toastWeg() {
    const t = $('#toast');
    if (!t) return;
    clearTimeout(t._timer);
    t.classList.remove('zeigen');
    t.hidden = true;
  }

  // Handy-Zurück-Taste bei Info-Fenstern (z. B. Übersicht, v84.10): Beim Öffnen wird ein
  // eigener Verlaufseintrag angelegt, die Zurück-Taste schließt dann nur das Fenster (wie ✕)
  // statt die Ansicht dahinter zu wechseln bzw. die App zu beenden. Schließt man per ✕ oder
  // „Schließen", wird der Eintrag mit history.back() entfernt – dieses popstate wird ignoriert.
  let infoVerlauf = false;
  let infoPopIgnorieren = 0;
  function infoVerlaufWeg() {
    if (!infoVerlauf) return;
    infoVerlauf = false;
    infoPopIgnorieren++;
    history.back();
  }
  function infoZurueckTaste() {
    if (infoPopIgnorieren) { infoPopIgnorieren--; return true; }
    if (!infoVerlauf) return false;
    infoVerlauf = false;
    const o = $('#modalOverlay');
    if (o.hidden || o._zu) return false;   // Fenster schon zu: normal weiter zurück
    $('#modalClose').click();              // wie ✕ – schließt auch einen Dialog, der es ersetzt hat
    return true;
  }

  function openInfoModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalCancel').hidden = true;
    $('#modalOk').textContent = 'Schließen';
    const overlay = $('#modalOverlay');
    openOverlay(overlay);
    if (!infoVerlauf) {
      history.pushState(Object.assign({}, history.state, { info: true }), '');
      infoVerlauf = true;
    }
    const close = () => { closeOverlay(overlay); infoVerlaufWeg(); };
    $('#modalOk').onclick = close;
    $('#modalClose').onclick = close;   // ✕ oben in der klebenden Kopfzeile
    $('#modalBody').scrollTop = 0;
    $('.modal', overlay).scrollTop = 0; // lange Inhalte immer oben starten
  }

  // Generisches Formular-Modal. fields: [{name,label,type,value,placeholder,required}]
  function openFormModal(title, fields, onSubmit) {
    $('#modalTitle').textContent = title;
    const body = $('#modalBody');
    body.innerHTML = fields.map((f) => {
      if (f.type === 'select') {
        const opts = f.options.map((o) =>
          `<option value="${escAttr(o.value)}"${o.value === f.value ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
        return `<label>${escHtml(f.label)}<select name="${f.name}">${opts}</select></label>`;
      }
      return `<label>${escHtml(f.label)}<input name="${f.name}" type="${f.type || 'text'}"
        value="${escAttr(f.value || '')}" placeholder="${escAttr(f.placeholder || '')}"
        ${f.required ? 'required' : ''} autocomplete="off" /></label>`;
    }).join('');
    $('#modalCancel').hidden = false;
    $('#modalOk').textContent = 'OK';
    const overlay = $('#modalOverlay');
    openOverlay(overlay);
    $('#modalCancel').onclick = () => { closeOverlay(overlay); };
    $('#modalClose').onclick = () => { closeOverlay(overlay); }; // ✕ = Abbrechen
    // onSubmit ist meist async: erst das Ergebnis abwarten. Vorher war es ein Promise und nie
    // `false` – der Dialog schloss auch bei fehlender Pflichtangabe, die Eingaben waren weg.
    let laeuft = false;
    $('#modalOk').onclick = async () => {
      if (laeuft) return;                  // Doppel-Tippen legt nichts doppelt an
      laeuft = true;
      try {
        const data = {};
        $$('#modalBody [name]').forEach((el) => { data[el.name] = el.value.trim(); });
        const ok = await onSubmit(data);
        if (ok !== false) closeOverlay(overlay);
      } finally {
        laeuft = false;
      }
    };
  }

  // Bestätigungs-Dialog. Liefert ein Promise<boolean> (true = bestätigt).
  function openConfirm(title, html, okLabel, danger, cancelLabel) {
    return new Promise((resolve) => {
      toastWeg();
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = html;
      const cancel = $('#modalCancel'), ok = $('#modalOk'), overlay = $('#modalOverlay');
      cancel.hidden = false;
      cancel.textContent = cancelLabel || 'Abbrechen';
      ok.textContent = okLabel || 'OK';
      ok.classList.toggle('danger', !!danger);
      openOverlay(overlay);
      const finish = (val) => {
        closeOverlay(overlay);
        ok.classList.remove('danger');
        ok.textContent = 'OK';
        cancel.textContent = 'Abbrechen';
        overlay.onclick = null;
        resolve(val);
      };
      cancel.onclick = () => finish(false);
      $('#modalClose').onclick = () => finish(false); // ✕ = Abbrechen (Promise auflösen!)
      ok.onclick = () => finish(true);
      overlay.onclick = (e) => { if (e.target === overlay) finish(false); }; // Tippen daneben = Abbrechen
    });
  }

  // Auswahl-Dialog: je Feld entscheiden, welcher von zwei Werten gilt.
  // felder: [{ name, label, eigen, paket, vorauswahl }] – vorauswahl 'eigen' | 'paket'.
  // Liefert { <name>: 'eigen' | 'paket', … } oder null, wenn nichts übernommen werden soll.
  // Abbrechen heißt hier bewusst NICHT „Import abbrechen", sondern „meine Werte behalten" –
  // deshalb ist der Knopf auch so beschriftet.
  function openChoiceModal(title, html, felder, labels) {
    toastWeg();
    return new Promise((resolve) => {
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = html + felder.map((f) => {
        const w = (v) => v === '' || v == null ? '(leer)' : v;
        return `<label>${escHtml(f.label)}
          <select name="${escAttr(f.name)}">
            <option value="eigen"${f.vorauswahl !== 'paket' ? ' selected' : ''}>${escHtml(w(f.eigen))} — deiner</option>
            <option value="paket"${f.vorauswahl === 'paket' ? ' selected' : ''}>${escHtml(w(f.paket))} — aus dem Paket</option>
          </select></label>`;
      }).join('');
      const cancel = $('#modalCancel'), ok = $('#modalOk'), overlay = $('#modalOverlay');
      cancel.hidden = false;
      cancel.textContent = (labels && labels.cancel) || 'Abbrechen';
      ok.textContent = (labels && labels.ok) || 'OK';
      openOverlay(overlay);
      const finish = (val) => {
        closeOverlay(overlay);
        cancel.textContent = 'Abbrechen';
        ok.textContent = 'OK';
        overlay.onclick = null;
        resolve(val);
      };
      cancel.onclick = () => finish(null);
      $('#modalClose').onclick = () => finish(null);
      ok.onclick = () => {
        const wahl = {};
        $$('#modalBody select[name]').forEach((el) => { wahl[el.name] = el.value; });
        finish(wahl);
      };
      overlay.onclick = (e) => { if (e.target === overlay) finish(null); };
    });
  }

  // Auswahl-Dialog mit großen Knöpfen statt OK/Abbrechen. Liefert den Schlüssel der
  // gewählten Option oder null (Abbruch).
  // WICHTIG: Was eine Option auslöst, läuft SYNCHRON im Klick-Handler (option.sofort) und
  // nicht erst, nachdem das Promise aufgelöst ist – Android öffnet die Dateiauswahl nur
  // direkt aus einer Nutzergeste heraus.
  function openAuswahl(title, html, optionen) {
    return new Promise((resolve) => {
      toastWeg();
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = html + '<div class="bigchoice">' + optionen.map((o) =>
        `<button type="button" class="bigbtn${o.cls ? ' ' + escAttr(o.cls) : ''}" data-key="${escAttr(o.key)}">
           <span class="bigbtn-emoji">${o.icon ? Icon(o.icon) : escHtml(o.emoji || '')}</span>
           <span class="bigbtn-title">${escHtml(o.titel)}</span>
           <span class="bigbtn-sub">${escHtml(o.sub || '')}</span>
         </button>`).join('') + '</div>';
      const cancel = $('#modalCancel'), ok = $('#modalOk'), overlay = $('#modalOverlay');
      ok.hidden = true;             // hier entscheiden die Knöpfe im Inhalt
      cancel.hidden = false;
      cancel.textContent = 'Abbrechen';
      openOverlay(overlay);
      const finish = (key) => {
        closeOverlay(overlay);
        ok.hidden = false;          // für alle anderen Dialoge zurückstellen
        overlay.onclick = null;
        resolve(key);
      };
      $$('#modalBody .bigbtn').forEach((b) => {
        b.onclick = () => {
          const o = optionen.find((x) => x.key === b.dataset.key);
          if (o && o.sofort) o.sofort();
          finish(b.dataset.key);
        };
      });
      cancel.onclick = () => finish(null);
      $('#modalClose').onclick = () => finish(null);
      overlay.onclick = (e) => { if (e.target === overlay) finish(null); };
    });
  }

  // Vierstellige Filialnummer aus beliebiger Schreibweise: „7423", „LI7423", „Li7423",
  // „DE7423", „7423 München", „Filiale 2 - 7423" -> alle „7423". Die Nummer ist die einzige
  // Angabe, die auf allen Geräten gleich ist – der Rest des Feldes wird frei getippt.
  // Fünfstellige Zahlen liefern bewusst nichts: das ist keine Filialnummer.
  function filialNr(text) {
    const m = String(text == null ? '' : text).match(/(?:^|\D)(\d{4})(?!\d)/);
    return m ? m[1] : null;
  }

  // Welche Pflicht-Stammdaten fehlen im GESPEICHERTEN Kopf des Auftrags? Maßgeblich ist der
  // gespeicherte Stand, nicht das Formular – eingetippt, aber nicht gespeichert, zählt nicht.
  // Leeres Ergebnis = Auftrag darf bearbeitet werden.
  const PFLICHT_STAMMDATEN = [['filiale', 'Bauvorhaben / Filiale'], ['ort', 'Ort'], ['datum', 'Datum']];
  function fehlendeStammdaten(job) {
    const h = (job && job.header) || {};
    return PFLICHT_STAMMDATEN
      .filter(([name]) => !String(h[name] == null ? '' : h[name]).trim())
      .map(([, label]) => label);
  }

  // Erklärt auf der Startseite, warum es nicht weitergeht: leere Felder markiert der Browser
  // selbst (reportValidity fokussiert das erste), sonst fehlt nur noch das Speichern.
  function stammdatenAnmahnen() {
    if (aktiveView !== 'view-start') show('view-start');
    const f = $('#projectForm');
    // Nur Leerzeichen gelten als leer (gespeichert wird getrimmt) – sonst hieße es fälschlich
    // „erst speichern", und nach dem Speichern bliebe der Auftrag trotzdem gesperrt.
    PFLICHT_STAMMDATEN.forEach(([name]) => { if (!f[name].value.trim()) f[name].value = ''; });
    if (!f.checkValidity()) {
      f.reportValidity();
      toast('Bitte zuerst die Stammdaten ausfüllen und speichern.');
    } else {
      const btn = f.querySelector('button[type="submit"]');
      if (btn) btn.scrollIntoView({ behavior: sanft(), block: 'center' });
      toast('Bitte die Stammdaten erst speichern.');
    }
  }

  // Liefert true, wenn die Datei das Gerät verlassen hat (geteilt oder heruntergeladen),
  // und false, wenn der Nutzer den Teilen-Dialog abgebrochen hat. Der Rückgabewert ist
  // wichtig: doBackupNow darf einen Auftrag nur dann als gesichert vermerken, wenn die ZIP
  // tatsächlich weitergegeben wurde – sonst meldet die Backup-Erinnerung „alles gesichert",
  // während die einzige Kopie weiterhin nur auf dem Handy liegt.
  async function shareFile(blob, filename, mime, title) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        toast('Geteilt: ' + filename);
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') {
          toast('Abgebrochen – die Datei wurde nicht abgelegt.');
          return false;
        }
        // sonst Fallback Download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Gespeichert: ' + filename);
    return true;
  }

  // Verständlicher Text zu einem Fehler. Ein voller Gerätespeicher meldet sich als
  // QuotaExceededError – ohne eigenen Hinweis liest der Techniker „Fehler beim Speichern"
  // und fotografiert weiter, obwohl ab jetzt jedes Bild verlorengeht.
  function fehlerText(err) {
    const name = err && err.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return 'Der Speicher des Geräts ist voll. Bitte zuerst sichern (ZIP-Export) und '
        + 'abgeschlossene Aufträge löschen – bis dahin können keine Bilder mehr gespeichert werden.';
    }
    return (err && err.message) || String(err);
  }

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ----------------------------------------------------- Auftrags-Verwaltung
  // Stellt sicher, dass ein aktiver Auftrag existiert (legt sonst „Auftrag 1" an).
  async function ensureCurrentJob() {
    const jobs = await DB.listJobs();
    let id = await DB.getCurrentJobId();
    let job = id ? jobs.find((j) => j.id === id) : null;
    if (!job) job = jobs[0] || null;
    if (!job) job = await DB.createJob('Auftrag 1');
    currentJob = job;
    await DB.setCurrentJobId(job.id);
  }

  async function switchJob(id) {
    const job = await DB.getJob(id);
    if (!job) return;
    await flushDiary();            // offene Eingaben gehören noch zum ALTEN Auftrag
    await Vorpruefung.flush();
    await Wochenbericht.flush();
    currentJob = job;
    await DB.setCurrentJobId(id);
    resetJobState();
    await loadStartView();
    toast('Auftrag „' + (job.name || job.header.filiale || '') + '" geöffnet');
  }

  // Nur der aktive Auftrag steht offen da; alle anderen liegen im Klappfeld „Weitere Aufträge".
  // Bei vielen Baustellen rutschten sonst die Stammdaten des aktiven Auftrags weit nach unten.
  // Das Feld ist beim Betreten der Startseite und nach jedem Auftragswechsel zu (resetJobState).
  let weitereOffen = false;

  async function renderJobList() {
    const cont = $('#jobList');
    if (!cont) return;
    const jobs = await DB.listJobs();   // zuletzt bearbeitet oben
    cont.innerHTML = '';
    const aktiv = currentJob ? jobs.find((j) => j.id === currentJob.id) : null;
    if (!aktiv) { jobs.forEach((j) => cont.appendChild(jobItem(j, false))); return; }
    cont.appendChild(jobItem(aktiv, true));
    const weitere = jobs.filter((j) => j !== aktiv);
    if (!weitere.length) return;

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'job-more';
    const liste = document.createElement('div');
    liste.className = 'job-more-list';
    weitere.forEach((j) => liste.appendChild(jobItem(j, false)));
    knopf.innerHTML = `<span class="chev">${Icon('chevron-right')}</span>Weitere Aufträge (${weitere.length})`;
    const zeige = () => {
      liste.hidden = !weitereOffen;
      knopf.classList.toggle('open', weitereOffen);
      knopf.setAttribute('aria-expanded', String(weitereOffen));
    };
    knopf.onclick = async () => {
      // Kein Input-Lockout: Tipp während des Zuklappens kürzt es ab und wird danach ausgeführt.
      if (knopf._klappt) { knopf._wartend = true; abkuerzen(liste); return; }
      weitereOffen = !weitereOffen;
      if (weitereOffen) { zeige(); animOpen(liste); return; }
      knopf._klappt = true;
      knopf.classList.remove('open');      // Pfeil dreht schon beim Zuklappen zurück
      await animClose(liste);
      knopf._klappt = false;
      // Erst die (stehengebliebene) Zuklapp-Animation lösen, DANN ausblenden: an einem
      // ausgeblendeten Element meldet der Browser sie nicht mehr, sie bliebe hängen und die
      // Liste stünde beim nächsten Öffnen mit Höhe 0 da.
      if (liste.getAnimations) liste.getAnimations().forEach((a) => a.cancel());
      liste.style.overflow = '';
      zeige();
      if (knopf._wartend) { knopf._wartend = false; knopf.onclick(); }
    };
    zeige();
    cont.appendChild(knopf);
    cont.appendChild(liste);
  }

  function jobItem(j, active) {
    const div = document.createElement('div');
    div.className = 'job-item' + (active ? ' active' : '');
    const sub = [j.header.filiale, j.header.ort, j.header.datum].filter(Boolean).join(' · ');
    div.innerHTML = `<div class="job-main">
        <div class="job-name">${escHtml(j.name || j.header.filiale || 'Auftrag')}</div>
        <div class="job-sub">${escHtml(sub)}</div>
      </div>
      <button class="job-edit" title="Umbenennen" aria-label="Umbenennen">${Icon('pencil')}</button>
      <button class="job-del" title="Löschen" aria-label="Löschen">${Icon('trash-2')}</button>`;
    div.querySelector('.job-main').onclick = () => { if (!active) switchJob(j.id); };
    div.querySelector('.job-edit').onclick = (e) => { e.stopPropagation(); renameJob(j); };
    div.querySelector('.job-del').onclick = (e) => { e.stopPropagation(); deleteJobFlow(j); };
    return div;
  }

  function renameJob(job) {
    openFormModal('Auftrag umbenennen', [
      { name: 'name', label: 'Name', value: job.name || '', required: true },
    ], async (data) => {
      const name = (data.name || '').trim();
      if (!name) return false;
      job.name = name;
      await DB.saveJob(job);
      if (currentJob && currentJob.id === job.id) currentJob.name = name;
      await renderJobList();
      toast('Umbenannt');
    });
  }

  async function deleteJobFlow(job) {
    const label = escHtml(job.name || job.header.filiale || 'Auftrag');
    const photoCount = (await DB.getAllPhotos(job.id)).length;

    // 1. Abfrage
    const ok1 = await openConfirm(
      'Auftrag löschen?',
      `<p>Auftrag <b>„${label}"</b> wirklich löschen?</p>
       <p class="hint">Dabei werden <b>${photoCount} Bild(er)</b> und alle Daten dieses
       Auftrags (Struktur, Bautagebuch-Tage) <b>unwiderruflich</b> gelöscht.</p>`,
      'Weiter zum Löschen', true);
    if (!ok1) return;

    // 2. Abfrage (Sicherheit)
    const ok2 = await openConfirm(
      'Wirklich endgültig löschen?',
      `<p>Letzte Sicherheitsabfrage: <b>„${label}"</b> endgültig löschen?</p>
       <p class="hint">Das kann <b>nicht rückgängig</b> gemacht werden.</p>`,
      'Endgültig löschen', true);
    if (!ok2) return;

    await DB.deleteJob(job.id);

    // War es der aktive Auftrag? Dann auf einen anderen wechseln (oder neuen anlegen).
    if (currentJob && currentJob.id === job.id) {
      currentJob = null;
      await DB.setCurrentJobId(null);
      resetJobState();
      await ensureCurrentJob();
    }
    await loadStartView();
    toast('Auftrag gelöscht');
  }

  // Zwei Wege in einen Auftrag: neue Baustelle (Stammdaten + Vorprüfung) oder laufende
  // Baustelle übernehmen. Beim Übernehmen entsteht der Auftrag komplett aus der Datei –
  // niemand tippt Stammdaten ab, und die Vorprüfung des Vorteams bleibt maßgeblich.
  async function newJobFlow() {
    const wahl = await openAuswahl('Auftrag anlegen',
      '<p class="hint">Beginnt hier eine neue Baustelle, oder wird eine laufende übernommen?</p>',
      [
        { key: 'neu', icon: 'hard-hat', titel: 'Neue Baustelle',
          sub: 'Stammdaten ausfüllen, danach die Vorprüfung' },
        { key: 'uebernahme', icon: 'download', titel: 'Baustelle übernehmen',
          sub: 'Übergabe-Datei (.xlsx) oder Bilddoku-ZIP einlesen – Stammdaten kommen mit',
          sofort: () => $('#startImport').click() },
      ]);
    // Die Übernahme läuft über die Dateiauswahl (importAnyFile); ein Abbruch legt bewusst
    // keinen leeren Auftrag an.
    if (wahl !== 'neu') return;
    await neuenAuftragAnlegen();
  }

  async function neuenAuftragAnlegen() {
    await flushDiary();            // offene Eingaben gehören noch zum bisherigen Auftrag
    await Vorpruefung.flush();
    await Wochenbericht.flush();
    const job = await DB.createJob('Auftrag ' + ((await DB.listJobs()).length + 1));
    currentJob = job;
    await DB.setCurrentJobId(job.id);
    resetJobState();
    await loadStartView();
    // Kein direkter Sprung: erst Stammdaten ausfüllen + speichern, danach folgt die
    // Vorprüfung automatisch (siehe saveProjectForm).
    toast('Neuer Auftrag – bitte Stammdaten ausfüllen und speichern');
  }

  // Füllt Auftragsliste + Projektkopf-Formular des aktiven Auftrags.
  async function loadStartView() {
    await renderJobList();
    const hint = $('#currentJobHint');
    if (hint) hint.textContent = currentJob ? '· ' + (currentJob.name || currentJob.header.filiale || '') : '';
    const h = (currentJob && currentJob.header) || {};
    const f = $('#projectForm');
    f.filiale.value = h.filiale || '';
    f.ort.value = h.ort || '';
    f.datum.value = h.datum || Datum.heute();
    f.beauftragung.value = h.beauftragung || 'NFK Vollverkabelung';
    renderSperre();
    renderVpStatus();
    await renderBackupReminder('#backupReminderStart');
    await renderSpeicher();
  }

  // ------------------------------------------------- Speicherplatz (ab v83)
  // navigator.storage.estimate(): belegt = Daten dieser App, frei = was der Browser ihr noch
  // zugesteht (auf dem Handy grob der freie Gerätespeicher). null, wenn nicht abfragbar.
  async function speicherStand() {
    try {
      if (!navigator.storage || !navigator.storage.estimate) return null;
      const e = await navigator.storage.estimate();
      if (!e || !e.quota) return null;
      const belegt = e.usage || 0;
      return { belegt, frei: Math.max(0, e.quota - belegt), quota: e.quota };
    } catch (e) {
      return null;
    }
  }
  const speicherZeile = (sp) => `${groesse(sp.belegt)} belegt · ca. ${groesse(sp.frei)} frei`;
  // Knapp: unter 1 GB frei oder über 80 % des zugestandenen Platzes belegt.
  const speicherKnapp = (sp) => sp.frei < 1e9 || sp.belegt > 0.8 * sp.quota;

  async function renderSpeicher() {
    const info = $('#speicherInfo'), warn = $('#speicherWarnung');
    const sp = await speicherStand();
    if (info) {
      info.hidden = !sp;
      if (sp) info.textContent = 'Speicher: ' + speicherZeile(sp);
    }
    if (warn) {
      const knapp = !!sp && speicherKnapp(sp);
      warn.hidden = !knapp;
      if (knapp) {
        warn.innerHTML = `<span class="bk-msg">Speicher wird knapp (noch ca. ${escHtml(groesse(sp.frei))} frei). `
          + 'Abgeschlossene Aufträge sichern (ZIP) und danach löschen – sonst können bald keine Bilder mehr gespeichert werden.</span>';
      }
    }
  }

  // Funktionsknöpfe dimmen und Hinweis zeigen, solange die Stammdaten nicht gespeichert sind.
  function renderSperre() {
    const gesperrt = fehlendeStammdaten(currentJob).length > 0;
    const wahl = $('.bigchoice');
    if (wahl) wahl.classList.toggle('gesperrt', gesperrt);
    const hinweis = $('#sperreHinweis');
    if (hinweis) hinweis.hidden = !gesperrt;
    UI.aktualisieren(currentJob);   // Kopfleiste + Stammdaten-Karte (nur Darstellung, js/ui.js)
  }

  // Zeigt auf der Startseite den Vorprüfungs-Status des aktiven Auftrags (Link zur View).
  function renderVpStatus() {
    const el = $('#vpStatus');
    if (!el) return;
    // Ohne gespeicherte Stammdaten gibt es noch nichts zu prüfen – kein rotes „0/7 offen".
    if (!currentJob || fehlendeStammdaten(currentJob).length) { el.hidden = true; return; }
    // Übernommene Baustelle: Die Vorprüfung gehört dem Vorteam – hier ist sie kein Thema mehr.
    if (Vorpruefung.entfaellt(currentJob)) { el.hidden = true; return; }
    const total = Vorpruefung.POINTS.length;
    const answered = Vorpruefung.answeredCount(currentJob);
    const done = !!(currentJob.vorpruefung && currentJob.vorpruefung.done);
    el.hidden = false;
    if (done) {
      el.className = 'vp-status ok';
      el.innerHTML = `<span>Vorprüfung abgeschlossen</span>
        <button type="button" class="btn ghost vp-open">${Icon('file-text')} Protokoll / ansehen</button>`;
    } else {
      el.className = 'vp-status open';
      el.innerHTML = `<span>Vorprüfung offen (${answered}/${total} beantwortet)</span>
        <button type="button" class="btn primary vp-open">Vorprüfung öffnen</button>`;
    }
    const btn = el.querySelector('.vp-open');
    if (btn) btn.onclick = () => goGuard('view-vorpruefung');
  }

  // --------------------------------------------------------- Backup-Erinnerung
  // Zeigt pro Auftrag an, ob ungesicherte Bilder vorliegen, und bietet den vollen
  // ZIP-Export als Sicherung an. „Gesichert" = es wurde eine ZIP erzeugt und geteilt;
  // der Android-Teilen-Dialog meldet keinen Erfolg zurück, daher gilt das Auslösen
  // als Sicherung. Echte Sicherheit entsteht erst, wenn die ZIP vom Handy weg ist.
  async function renderBackupReminder(sel) {
    const el = $(sel);
    if (!el) return;
    const job = currentJob;
    if (!job) { el.hidden = true; return; }

    // Nur Bilddoku-Bilder: Fotos aus Vorprüfung und Baubehinderungsanzeige stecken nicht
    // im ZIP-Export, dürfen die Sicherungswarnung also weder auslösen noch hochzählen.
    const photos = await DB.getBilddokuPhotos(job.id);
    if (!photos.length) { el.hidden = true; return; } // nichts zu verlieren

    const last = job.lastBackupAt || 0;
    // Maßgeblich ist, wann das Bild auf DIESES Gerät kam: bei übernommenen Bildern trägt
    // createdAt die Aufnahmezeit des Kollegen und liegt oft vor der letzten eigenen
    // Sicherung – ohne importedAt meldete der Banner direkt nach einem Merge „alles
    // gesichert", obwohl hunderte Bilder noch in keiner ZIP stecken.
    const aufDemGeraetSeit = (p) => Math.max(p.createdAt || 0, p.importedAt || 0);
    const unsaved = photos.filter((p) => aufDemGeraetSeit(p) > last).length;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const ago = days === null ? '' : days <= 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`;

    let cls, msg;
    if (unsaved > 0) {
      cls = (!last || days >= 1) ? 'warn' : 'info';
      msg = !last
        ? `Noch nie gesichert – ${photos.length} Bild${photos.length === 1 ? '' : 'er'} nur auf diesem Handy.`
        : `${unsaved} neue${unsaved === 1 ? 's Bild' : ' Bilder'} seit der letzten Sicherung (${ago}).`;
    } else {
      cls = 'ok';
      msg = `Alle Bilder gesichert (zuletzt ${ago}).`;
    }

    el.className = 'backup-banner ' + cls;
    el.hidden = false;
    el.innerHTML = `<span class="bk-msg"></span>` +
      `<button type="button" class="btn primary bk-save">${Icon('save')} Jetzt sichern</button>`;
    el.querySelector('.bk-msg').textContent = msg;
    el.querySelector('.bk-save').onclick = busy(doBackupNow);
  }

  // Erzeugt den vollen Bilddoku-ZIP (= komplette Sicherung) und merkt den Zeitpunkt.
  async function doBackupNow() {
    toast('Erzeuge Sicherung…');
    try {
      const res = await ExportZip.build();
      // Nur als gesichert vermerken, wenn die ZIP das Gerät wirklich verlassen hat.
      if (res && res.totalPhotos && res.geteilt) {
        currentJob.lastBackupAt = Date.now();
        await DB.saveJob(currentJob);
        toast('Sicherung erstellt – bitte in Drive/Chat ablegen.');
      } else if (res && res.totalPhotos) {
        toast('Sicherung NICHT abgelegt – bitte erneut sichern.', 4200);
      }
    } catch (e) {
      console.error(e);
      toast('Sicherung fehlgeschlagen: ' + (e.message || e));
    }
    await renderBackupReminder('#backupReminder');
    await renderBackupReminder('#backupReminderStart');
    await renderSpeicher();
  }

  async function saveProjectForm(e) {
    e.preventDefault();
    const f = e.target;
    currentJob.header = {
      filiale: f.filiale.value.trim(),
      ort: f.ort.value.trim(),
      datum: f.datum.value,
      beauftragung: f.beauftragung.value.trim() || 'NFK Vollverkabelung',
      // Team wird nicht mehr auf der Startseite gepflegt, sondern pro Tag im
      // Bautagebuch. Vorhandenen Wert erhalten (u. a. für die Übergabe-Datei).
      techniker: (currentJob.header && currentJob.header.techniker) || [],
    };
    // Auftragsname an Filiale koppeln, solange er nicht manuell vergeben wurde.
    if (!currentJob.name || /^Auftrag \d+$/.test(currentJob.name)) {
      currentJob.name = currentJob.header.filiale || currentJob.name;
    }
    await DB.saveJob(currentJob);
    await renderJobList();
    renderSperre();
    renderVpStatus();
    const saved = $('#projectSaved');
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2000);
    toast('Stammdaten gespeichert');
    // Nach dem Speichern der Stammdaten in die Pflicht-Vorprüfung wechseln, solange
    // sie für diesen Auftrag noch nicht vollständig ist.
    if (Vorpruefung.isIncomplete(currentJob)) show('view-vorpruefung');
  }

  // --------------------------------------------------------- Bilddoku-Tree
  function revokeThumbs() {
    activeUrls.forEach((u) => URL.revokeObjectURL(u));
    activeUrls = [];
  }

  let catalogNames = null; // gemerkte Tab-Liste der Vorlagen-Sammlung

  // Wird beim Öffnen der Bilddoku-Ansicht aufgerufen: Vorlagen-Katalog laden,
  // beim allerersten Mal automatisch die Standard-Vorlage importieren, Dropdown füllen.
  async function enterBilddoku() {
    await renderTree(); // sofort zeigen, was schon da ist (auch offline ohne ExcelJS)
    await renderBackupReminder('#backupReminder'); // unabhängig vom (langsamen) Katalog-Laden
    try {
      if (!catalogNames) catalogNames = await Structure.listTemplates();
    } catch (e) {
      console.warn('Vorlagen-Katalog nicht ladbar:', e);
    }

    const haveStructure = ((currentJob && currentJob.structure) || []).length > 0;
    let selected = await Structure.getSelectedTemplate();

    // Erststart: Standard-Vorlage (erstes Tab) automatisch importieren.
    if (!haveStructure && catalogNames && catalogNames.length) {
      const def = (selected && catalogNames.indexOf(selected) !== -1) ? selected : catalogNames[0];
      try {
        await Structure.importFromCatalog(def);
        selected = def;
        await renderTree();
      } catch (e) { console.warn('Auto-Import fehlgeschlagen:', e); }
    }

    populateTemplateSelect(selected);
    // Einmal beim Öffnen erklären, warum oben eine gesperrte Vorlage steht.
    if (vorlageFehlt(selected)) {
      toast(`Vorlage „${selected}" gibt es nicht mehr. Dein Auftrag behält alle Positionen und `
        + 'Bilder. Oben eine neue Vorlage wählen – Bilder und Zähler ziehen mit um.', 6000);
    }
    await pruefeVorlagenUpdate();
  }

  // Mit dem App-Update kommt auch eine neue templates.xlsx aufs Handy. In laufende Aufträge
  // wandert sie aber NICHT von allein: Die Struktur mitten im Einsatz auszutauschen wäre
  // eine Überraschung, und ein versehentlich hochgeladener Stand träfe sonst sofort alle.
  // Deshalb hier ein Hinweis mit zwei Knöpfen. Ohne eigene Bilder ist nichts zu verlieren –
  // dann wird die neue Fassung stillschweigend übernommen.
  async function pruefeVorlagenUpdate() {
    let info = null;
    try {
      info = await Structure.neueFassung(currentJob);
    } catch (e) {
      console.warn('Vorlagen-Fassung nicht prüfbar (offline?):', e);
      return;   // offline ist kein Fehler: es bleibt einfach beim aktuellen Stand
    }
    if (!info) return;
    const jobId = currentJob && currentJob.id;
    try {
      const fotos = await DB.getBilddokuPhotos(jobId);
      if (!fotos.length) {
        const { bericht } = await Structure.uebernehmeFassung(info);
        if (!currentJob || currentJob.id !== jobId) return;   // inzwischen Auftrag gewechselt
        await renderTree();
        toast(`Vorlage „${info.name}" auf den neuesten Stand gebracht` + umzugText(bericht), 4200);
        return;
      }
      const aenderung = [
        info.dazu ? `<b>${info.dazu}</b> Position(en) mehr` : '',
        info.weg ? `<b>${info.weg}</b> Position(en) weniger oder umbenannt` : '',
      ].filter(Boolean).join(' · ') || 'kleine Änderungen (z. B. Pflichtanzahl)';
      const ok = await openConfirm('Neue Fassung der Vorlage',
        `<p>Für „${escHtml(info.name)}" gibt es eine neue Fassung: ${aenderung}.</p>
         <p>Deine Bilder, Zähler und „nicht benötigt"-Markierungen ziehen dabei mit um.</p>
         <p class="hint">„Später" fragt erst wieder, wenn eine weitere Fassung kommt.</p>`,
        'Jetzt übernehmen', false, 'Später');
      if (!currentJob || currentJob.id !== jobId) return;
      if (!ok) { await Structure.spaeter(info); return; }
      const { bericht } = await Structure.uebernehmeFassung(info);
      await renderTree();
      populateTemplateSelect(info.name);
      toast(`Vorlage „${info.name}" aktualisiert` + umzugText(bericht), 4200);
    } catch (e) {
      console.error('Vorlagen-Update fehlgeschlagen:', e);
      toast('Vorlage konnte nicht aktualisiert werden');
    }
  }

  // Der gespeicherte Vorlagenname existiert im Katalog nicht mehr: umbenanntes oder
  // entferntes Tab in templates.xlsx. Der Auftrag behält seine Struktur, nachladen lässt
  // sich diese Vorlage aber nicht mehr – deshalb als „nicht mehr verfügbar" anzeigen und
  // sperren, statt beim Antippen mit „Vorlage konnte nicht geladen werden" abzubrechen.
  // Nur bei geladenem Katalog: offline ist die Liste leer, dann ist nichts „verschwunden".
  function vorlageFehlt(name) {
    return !!name && !!(catalogNames && catalogNames.length)
      && catalogNames.indexOf(name) === -1
      && name !== Structure.EXTERNAL_LABEL && name !== Structure.HANDOVER_LABEL;
  }

  function populateTemplateSelect(selected) {
    const sel = $('#templateSelect');
    const names = (catalogNames || []).slice();
    // „Eigener Import" als Option zeigen, falls aktiv und nicht im Katalog.
    if (selected && selected !== '' && names.indexOf(selected) === -1) names.unshift(selected);
    sel.innerHTML = names.map((n) => {
      const fehlt = n === selected && vorlageFehlt(n);
      return `<option value="${escAttr(n)}"${n === selected ? ' selected' : ''}${fehlt ? ' disabled' : ''}>`
        + escHtml(n) + (fehlt ? ' (nicht mehr verfügbar)' : '') + '</option>';
    }).join('');
    if (!names.length) sel.innerHTML = '<option value="">— keine Vorlage —</option>';
    passeVorlagenSchrift();
  }

  // Ein <select> kann nicht umbrechen: Auf dem Handy war „NFK Vollverkabelung 3x43HE" bei
  // 15 px abgeschnitten („NFK Vollverkabelun…"). Die Schrift wird deshalb so weit verkleinert
  // (15 → mind. 11 px), dass der gewählte Name ganz hineinpasst. Ein ResizeObserver rechnet
  // neu, sobald das Feld sichtbar wird oder sich die Breite ändert (Drehen, Fenstergröße).
  const VORLAGE_SCHRIFT = { max: 15, min: 11 };
  let vorlagenMessung = null;
  function passeVorlagenSchrift() {
    const sel = $('#templateSelect');
    if (!sel) return;
    if (!sel._beobachtet && window.ResizeObserver) {
      sel._beobachtet = true;
      new ResizeObserver(() => passeVorlagenSchrift()).observe(sel);
    }
    const opt = sel.options[sel.selectedIndex];
    const text = opt ? opt.textContent : '';
    const cs = getComputedStyle(sel);
    // Platz für den Text: Breite minus Innenabstand links und Pfeil rechts (≈ 36 px, mit Sicherheitsrand – bei 28 px kappte Chrome noch die letzten Zeichen).
    const platz = sel.clientWidth - parseFloat(cs.paddingLeft) - 36;
    if (!text || platz <= 0) return;
    vorlagenMessung = vorlagenMessung || document.createElement('canvas').getContext('2d');
    vorlagenMessung.font = `${cs.fontWeight} ${VORLAGE_SCHRIFT.max}px ${cs.fontFamily}`;
    const breite = vorlagenMessung.measureText(text).width;
    const groesse = Math.max(VORLAGE_SCHRIFT.min,
      Math.min(VORLAGE_SCHRIFT.max, Math.floor(VORLAGE_SCHRIFT.max * platz / breite * 10) / 10));
    sel.style.fontSize = groesse + 'px';
  }

  // Rückmeldung zum Umzug beim Vorlagenwechsel (siehe Structure.uebernehmeStruktur).
  // Umbenannte Ordner/Namen sind der Normalfall; nur was übrig bleibt, muss auffallen.
  function umzugText(bericht) {
    if (!bericht) return '';
    const teile = [];
    if (bericht.verschoben) {
      teile.push(`${bericht.verschoben} Bild(er) umgezogen`
        + (bericht.positionen ? ` (${bericht.positionen} Position(en))` : ''));
    }
    if (bericht.offen) teile.push(`⚠ ${bericht.offen} Bild(er) ohne neue Position – behalten unter „aus alter Vorlage"`);
    if (bericht.offenPrior) teile.push(`⚠ ${bericht.offenPrior} Vorteam-Bild(er) ohne Zuordnung`);
    return teile.length ? ' · ' + teile.join(' · ') : '';
  }

  async function onTemplateChange() {
    const name = $('#templateSelect').value;
    if (!name || name === Structure.EXTERNAL_LABEL || name === Structure.HANDOVER_LABEL) return;
    toast('Lade Vorlage…');
    try {
      const { bericht } = await Structure.importFromCatalog(name);
      await renderTree();
      // Liste neu aufbauen: der alte, nicht mehr vorhandene Name verschwindet damit.
      populateTemplateSelect(name);
      toast('Vorlage „' + name + '" geladen' + umzugText(bericht), 4200);
    } catch (e) {
      console.error(e);
      toast('Vorlage konnte nicht geladen werden');
    }
  }

  async function refreshCatalog() {
    toast('Aktualisiere Vorlagen…');
    try {
      catalogNames = await Structure.listTemplates(true);   // Datei wirklich neu laden
      const selected = await Structure.getSelectedTemplate();
      // Aktuell gewählte Vorlage neu einlesen (falls Tab geändert wurde).
      let bericht = null;
      if (selected && catalogNames.indexOf(selected) !== -1) {
        bericht = (await Structure.importFromCatalog(selected)).bericht;
        await renderTree();
      }
      populateTemplateSelect(selected);
      toast(catalogNames.length + ' Vorlage(n) verfügbar' + umzugText(bericht), 4200);
    } catch (e) {
      console.error(e);
      toast('Aktualisieren fehlgeschlagen (offline?)');
    }
  }

  // Aufklapp-Zustand des Baums (bleibt über Re-Renders erhalten; Default: alles zu).
  // Je Ebene ist höchstens ein Ordner offen (siehe Klick-Handler in renderTree).
  const expandedObers = new Set();
  const expandedUnters = new Set();

  // „nicht benötigt"-Markierungen des aktuellen Auftrags. level ∈ {'obers','unters','nodes'}.
  function skipSet(level) {
    const j = currentJob;
    return (j && j.skipped && j.skipped[level]) || [];
  }
  async function toggleSkip(level, key) {
    const job = App.getCurrentJob();
    if (!job.skipped) job.skipped = { obers: [], unters: [], nodes: [] };
    if (!job.skipped[level]) job.skipped[level] = [];
    const arr = job.skipped[level];
    const i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1); else arr.push(key);
    await App.saveCurrentJob();
    await renderTree();
  }

  // ------------------------------------------- Eigene Namen/Bereiche kennzeichnen
  // Selbst angelegte Positionen tragen source 'custom', über „Beiträge zusammenführen"
  // eingespielte 'merge'. Beide sind löschbar, werden aber unterschiedlich beschriftet,
  // damit niemand versehentlich fremde Bilder entfernt.
  // „short" für Ordner-Kopfzeilen: dort teilen sich Name, Abzeichen, Zähler und zwei
  // Knöpfe eine Zeile – mit dem langen Text bliebe für den Namen auf 360 px Breite zu
  // wenig übrig und er würde mitten im Wort umbrechen. Die Langfassung steht im Tooltip.
  const ORIGIN = {
    custom: { cls: 'custom', text: 'eigen', short: 'eigen', title: 'selbst angelegt – kann gelöscht werden' },
    merge: { cls: 'merge', text: 'von Kollege', short: 'Kollege', title: 'über „Beiträge zusammenführen" dazugekommen' },
    alt: { cls: 'alt', text: 'aus alter Vorlage', short: 'alte Vorlage',
      title: 'gibt es in der aktuellen Vorlage nicht mehr – die Bilder wurden behalten' },
  };
  const originOf = (n) => ORIGIN[n && n.source] || null;
  const isOwnNode = (n) => !!originOf(n);

  function originTag(n) {
    const o = originOf(n);
    return o ? ` <span class="origin-tag ${o.cls}" title="${escAttr(o.title)}">${escHtml(o.text)}</span>` : '';
  }

  // Herkunft eines Ordners: nur „eigen", wenn KEINE einzige Position daraus aus der
  // Vorlage stammt. Gemischte Ordner (Vorlage + eigener Name) bleiben unmarkiert und
  // ohne Sammel-Löschknopf – sonst ließen sich darüber Vorlagenpositionen mitlöschen.
  function folderOrigin(nodes) {
    if (!nodes.length || !nodes.every(isOwnNode)) return null;
    if (nodes.some((n) => n.source === 'merge')) return ORIGIN.merge;
    return nodes.every((n) => n.source === 'alt') ? ORIGIN.alt : ORIGIN.custom;
  }

  // Entfernt eigene Positionen restlos: Fotos, Eintrag in customNames, übernommene
  // Zähler und „nicht benötigt"-Markierung. Speichert NICHT – das macht der Aufrufer.
  async function removeCustomNodes(nodes) {
    const job = currentJob;
    let fotos = 0;
    for (const n of nodes) {
      for (const p of await DB.getPhotos(job.id, n.key)) {
        await DB.deletePhotoById(p.id);
        fotos++;
      }
      if (job.customNames) job.customNames = job.customNames.filter((c) => c.key !== n.key);
      if (job.priorCounts) delete job.priorCounts[n.key];
      if (job.skipped && job.skipped.nodes) {
        job.skipped.nodes = job.skipped.nodes.filter((k) => k !== n.key);
      }
    }
    return fotos;
  }

  async function countPhotosOf(nodes) {
    let n = 0;
    for (const node of nodes) n += await DB.countPhotos(currentJob.id, node.key);
    return n;
  }

  const bildText = (n) => n === 1 ? '1 Bild wird' : `${n} Bilder werden`;
  // Hinweis nur zeigen, wenn es überhaupt Bilder gibt – sonst widerspricht er dem Satz
  // „Es hängen keine Bilder daran".
  const fremdHinweis = (o, fotos) => {
    if (!(fotos > 0)) return '';
    if (o === ORIGIN.merge) {
      return '<p class="hint">Achtung: Diese Bilder stammen von einem Kollegen und wurden über „Beiträge zusammenführen" übernommen.</p>';
    }
    if (o === ORIGIN.alt) {
      return '<p class="hint">Achtung: Diese Bilder wurden unter der alten Vorlage aufgenommen. '
        + 'Sind sie noch nicht per ZIP gesichert, sind sie danach endgültig weg.</p>';
    }
    return '';
  };

  async function deleteCustomNameFlow(node) {
    const o = originOf(node);
    const fotos = await DB.countPhotos(currentJob.id, node.key);
    const ok = await openConfirm(
      'Eigenen Namen löschen?',
      `<p>Position <b>„${escHtml(node.bildname)}"</b> wirklich löschen?</p>
       <p class="hint">${fotos ? bildText(fotos) + ' mit gelöscht. ' : 'Es hängen keine Bilder daran. '}
       Das kann nicht rückgängig gemacht werden.</p>${fremdHinweis(o, fotos)}`,
      'Löschen', true);
    if (!ok) return;
    await removeCustomNodes([node]);
    await saveCurrentJob();
    await renderTree();
    await renderBackupReminder('#backupReminder');
    toast('Name gelöscht');
  }

  async function deleteCustomFolderFlow(nodes, label, level, folderKey) {
    const o = folderOrigin(nodes);
    const fotos = await countPhotosOf(nodes);
    const ok = await openConfirm(
      'Eigenen Bereich löschen?',
      `<p>Bereich <b>„${escHtml(label)}"</b> mit <b>${nodes.length} Position${nodes.length === 1 ? '' : 'en'}</b>
       wirklich löschen?</p>
       <p class="hint">${fotos ? bildText(fotos) + ' mit gelöscht. ' : 'Es hängen keine Bilder daran. '}
       Das kann nicht rückgängig gemacht werden.</p>${fremdHinweis(o, fotos)}`,
      'Löschen', true);
    if (!ok) return;
    await removeCustomNodes(nodes);
    // Ordner-eigene Reste: „nicht benötigt"-Markierung und Aufklapp-Zustand.
    const job = currentJob;
    if (job.skipped && job.skipped[level]) {
      job.skipped[level] = job.skipped[level].filter((k) => k !== folderKey);
    }
    (level === 'obers' ? expandedObers : expandedUnters).delete(folderKey);
    await saveCurrentJob();
    await renderTree();
    await renderBackupReminder('#backupReminder');
    toast('Bereich gelöscht');
  }

  // Läuft renderTree erneut an, während ein vorheriger Lauf noch auf die Datenbank wartet,
  // widerruft der neue Lauf per revokeThumbs die Object-URLs, die der alte gerade in seine
  // <img>-Elemente schreibt: schwarze Vorschaubilder und doppelt einsortierte Zeilen.
  // Deshalb bekommt jeder Lauf eine Generation; überholte Läufe brechen am nächsten
  // Prüfpunkt ab, ohne den Baum weiter anzufassen.
  //
  // Neuaufbau ohne Springen: Der Baum entsteht außerhalb der Seite und ersetzt den alten in
  // einem Schritt. Vorher wurde er geleert und Zeile für Zeile (mit Wartezeit auf die
  // Fotos) neu befüllt – dazwischen war die Seite kurz, und der Browser schob die Ansicht
  // nach oben. Die Vorschaubilder des alten Baums werden erst nach dem Tausch freigegeben.
  // anker = { ober } | { unter }: diese Kopfzeile bleibt auf derselben Bildschirmhöhe, auch
  // wenn darüber ein langer Ordner zuklappt.
  let treeGen = 0;
  // Animation: zuletzt aufgeklappter Ordner (wird nach dem Neuaufbau weich aufgezogen),
  // Sperre gegen Doppel-Tippen während des Zuklappens und der Erledigt-Stand des letzten
  // Aufbaus – nur was seitdem NEU erledigt ist, bekommt den kurzen Haken-Effekt.
  let treeAufgeklappt = null;
  let treeKlappt = false;
  let treeStand = new Map();
  function treeKopf(anker) {
    if (!anker) return null;
    if (anker.unter != null) return $$('#structureTree .tree-unter').find((e) => e.dataset.unter === anker.unter) || null;
    return $$('#structureTree .tree-ober').find((e) => e.dataset.ober === anker.ober) || null;
  }
  // Klick auf eine Ordner-Kopfzeile: den offenen Ordner dieser Ebene erst sichtbar zuklappen,
  // dann den neuen Zustand zeichnen. sel = Kopfzeilen-Klasse der Ebene.
  // Kein Input-Lockout (v84.3): Ein Tipp während einer laufenden Umschaltung geht nicht
  // verloren. Er wird gemerkt (nur der jüngste zählt), die laufende Zuklapp-Animation wird
  // sofort zu Ende geführt, danach läuft der gemerkte Tipp regulär durch denselben Ablauf.
  let treeWartend = null;
  let treeZuBody = null;
  async function treeUmschalten(sel, umschalten, anker) {
    if (treeKlappt) {
      treeWartend = { sel, umschalten, anker };
      abkuerzen(treeZuBody);
      return;
    }
    treeKlappt = true;
    try {
      const kopf = $(`#structureTree ${sel}.open`);
      const body = kopf && kopf.nextElementSibling;
      if (body && body.classList.contains('tree-body')) {
        kopf.classList.add('zu');            // Pfeil dreht schon mit zurück
        // Klappt ein langer Ordner OBERHALB des angetippten zu, würde die Seite unter dem
        // Finger wegrutschen und der angetippte Ordner nach oben aus dem Bild laufen.
        // Deshalb hält die Ansicht ihn während der Animation Bild für Bild an seiner Stelle.
        const halt = halteKopf(treeKopf(anker));
        // Die Animation startet mit der sichtbaren Höhe statt der vollen – der Rest eines langen
        // Ordners fällt sofort weg. Diese Starthöhe schon vorher setzen und den Sprung im selben
        // Moment ausgleichen (der Ordner wird danach ohnehin neu gezeichnet).
        if (!ohneAnimation(body)) {
          body.style.height = sichtbareHoehe(body, body.offsetHeight) + 'px';
          body.style.overflow = 'hidden';
          halt.jetzt();
        }
        treeZuBody = body;
        const zu = animClose(body);
        await zu;
        treeZuBody = null;
        halt.jetzt();
        halt.stop();
      }
      if (umschalten()) treeAufgeklappt = anker;
      await renderTree(anker);
    } finally {
      treeKlappt = false;
      treeZuBody = null;
    }
    if (treeWartend) {
      const w = treeWartend;
      treeWartend = null;
      await treeUmschalten(w.sel, w.umschalten, w.anker);
    }
  }

  // Laufende Klapp-Animation eines Ordnerinhalts sofort in den Endzustand bringen.
  function abkuerzen(el) {
    if (el && el.getAnimations) el.getAnimations().forEach((a) => { try { a.finish(); } catch (e) { /* egal */ } });
  }

  // Hält eine Kopfzeile während einer Animation auf derselben Bildschirmhöhe (scrollt Bild
  // für Bild mit). jetzt() gleicht sofort aus, stop() beendet das Mitscrollen.
  function halteKopf(el) {
    if (!el) return { jetzt() {}, stop() {} };
    const soll = el.getBoundingClientRect().top;
    let laeuft = true;
    const jetzt = () => {
      if (!el.isConnected) return;
      const diff = el.getBoundingClientRect().top - soll;
      if (Math.abs(diff) >= 1) window.scrollBy(0, diff);
    };
    const schritt = () => {
      if (!laeuft) return;
      jetzt();
      requestAnimationFrame(schritt);
    };
    requestAnimationFrame(schritt);
    return { jetzt, stop() { laeuft = false; } };
  }

  // Frisch aufgeklappter Ordner: Kopfzeile weich an den oberen Rand (unter die Kopfleiste)
  // schieben, damit sein Inhalt darunter vollständig im Blick ist. Liefert die Zielhöhe.
  function kopfNachOben(kopf) {
    const leiste = $('.topbar');
    const oben = (leiste ? leiste.getBoundingClientRect().bottom : 0) + 8;
    const ziel = Math.max(0, window.scrollY + kopf.getBoundingClientRect().top - oben);
    window.scrollTo({ top: ziel, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    return oben + kopf.offsetHeight;
  }

  async function renderTree(anker) {
    const gen = ++treeGen;
    const stand = new Map();               // Erledigt-Stand dieses Aufbaus (für den Haken-Effekt)
    const popEls = [];
    const merke = (key, done, el) => {
      stand.set(key, done);
      if (done && el && treeStand.get(key) === false) popEls.push(el);
    };
    const info = $('#templateInfo');
    const tree = $('#structureTree');
    const urls = [];                       // Vorschaubilder dieses Laufs
    const veraltet = () => {
      if (gen === treeGen) return false;
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.length = 0;
      return true;
    };

    const nodes = await Structure.getMerged();
    if (veraltet()) return;
    const tplCount = ((currentJob && currentJob.structure) || []).length;
    info.textContent = nodes.length
      ? `${nodes.length} Positionen (${tplCount} aus Vorlage, ${nodes.length - tplCount} eigene).`
      : 'Vorlage wird geladen … (oben auswählen oder eigene Excel importieren).';

    if (nodes.length === 0) { tree.innerHTML = ''; revokeThumbs(); return; }

    const enriched = await Overview.enrich(nodes);
    if (veraltet()) return;
    const grp = Structure.groupForDisplay(enriched);

    const frag = document.createDocumentFragment();
    for (const [ober, unterMap] of grp) {
      const allNodes = [];
      for (const list of unterMap.values()) for (const n of list) allNodes.push(n);
      // Statistik (erledigt/gesamt) nur über benötigte (nicht geskippte) Positionen.
      const needed = allNodes.filter((n) => !n.skipped);
      const oberDone = needed.filter((n) => n.done).length;
      const oberAllDone = needed.length > 0 && oberDone >= needed.length;
      const oberNotNeeded = allNodes.length > 0 && needed.length === 0;
      const oberSkip = (skipSet('obers')).includes(ober);
      const oberExpanded = expandedObers.has(ober);

      const oberOrigin = folderOrigin(allNodes);

      const head = document.createElement('div');
      head.className = 'tree-ober' + (oberExpanded ? ' open' : '')
        + (oberAllDone ? ' alldone' : '') + (oberNotNeeded ? ' skipped' : '')
        + (oberOrigin ? ' origin-' + oberOrigin.cls : '');
      if (!oberNotNeeded) head.style.setProperty('--p', needed.length ? (oberDone / needed.length).toFixed(3) : 0);
      head.innerHTML = `<span class="chev">${Icon('chevron-right')}</span><span class="grp-folder" aria-hidden="true">${Icon('folder', 'zu')}${Icon('folder-open', 'auf')}</span>
        <span class="grp-name">${escHtml(ober)}${oberOrigin ? ` <span class="origin-tag ${oberOrigin.cls}" title="${escAttr(oberOrigin.title)}">${escHtml(oberOrigin.short)}</span>` : ''}</span>
        ${oberAllDone ? '<span class="grp-check" title="alle Pflichtbilder erledigt">' + Icon('circle-check') + '</span>' : ''}
        ${oberNotNeeded
          ? '<span class="grp-stat skip">nicht benötigt</span>'
          : `<span class="grp-stat${oberAllDone ? ' done' : ''}">${oberDone}/${needed.length}</span>`}
        <button class="skip-btn" title="${oberSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}" aria-label="${oberSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${Icon(oberSkip ? 'rotate-ccw' : 'circle-slash')}</button>
        ${oberOrigin ? '<button class="del-btn" title="Bereich mit allen Positionen löschen" aria-label="Bereich mit allen Positionen löschen">' + Icon('trash-2') + '</button>' : ''}`;
      head.dataset.ober = ober;
      // Immer nur ein Oberordner offen; beim Wechsel sind dessen Unterordner wieder zu.
      head.onclick = () => treeUmschalten('.tree-ober', () => {
        const warOffen = expandedObers.has(ober);
        expandedObers.clear();
        expandedUnters.clear();
        if (!warOffen) expandedObers.add(ober);
        return !warOffen;
      }, { ober });
      head.querySelector('.skip-btn').onclick = (e) => { e.stopPropagation(); toggleSkip('obers', ober); };
      const oberDel = head.querySelector('.del-btn');
      if (oberDel) oberDel.onclick = (e) => {
        e.stopPropagation();           // sonst klappt nur der Ordner auf/zu
        deleteCustomFolderFlow(allNodes, ober, 'obers', ober);
      };
      frag.appendChild(head);
      merke('o:' + ober, oberAllDone, head.querySelector('.grp-check'));

      if (!oberExpanded) continue; // Inhalt zugeklappter Ordner wird nicht gebaut

      const body = document.createElement('div');
      body.className = 'tree-body';
      frag.appendChild(body);

      for (const [uk, list] of unterMap) {
        if (uk) {
          const uKey = ober + Structure.SEP + uk;
          const uNeeded = list.filter((n) => !n.skipped);
          const uDone = uNeeded.filter((n) => n.done).length;
          const uAllDone = uNeeded.length > 0 && uDone >= uNeeded.length;
          const uNotNeeded = list.length > 0 && uNeeded.length === 0;
          const uSkip = (skipSet('unters')).includes(uKey);
          const uExpanded = expandedUnters.has(uKey);

          const uOrigin = folderOrigin(list);

          const uHead = document.createElement('div');
          uHead.className = 'tree-unter' + (uExpanded ? ' open' : '')
            + (uAllDone ? ' alldone' : '') + (uNotNeeded ? ' skipped' : '')
            + (uOrigin ? ' origin-' + uOrigin.cls : '');
          if (!uNotNeeded) uHead.style.setProperty('--p', uNeeded.length ? (uDone / uNeeded.length).toFixed(3) : 0);
          uHead.innerHTML = `<span class="chev">${Icon('chevron-right')}</span>
            <span class="grp-name">${escHtml(uk)}${uOrigin ? ` <span class="origin-tag ${uOrigin.cls}" title="${escAttr(uOrigin.title)}">${escHtml(uOrigin.short)}</span>` : ''}</span>
            ${uAllDone ? '<span class="grp-check" title="alle Pflichtbilder erledigt">' + Icon('circle-check') + '</span>' : ''}
            ${uNotNeeded
              ? '<span class="grp-stat skip">nicht benötigt</span>'
              : `<span class="grp-stat${uAllDone ? ' done' : ''}">${uDone}/${uNeeded.length}</span>`}
            <button class="skip-btn" title="${uSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}" aria-label="${uSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${Icon(uSkip ? 'rotate-ccw' : 'circle-slash')}</button>
            ${uOrigin ? '<button class="del-btn" title="Unterordner mit allen Positionen löschen" aria-label="Unterordner mit allen Positionen löschen">' + Icon('trash-2') + '</button>' : ''}`;
          uHead.dataset.unter = uKey;
          // Immer nur ein Unterordner offen.
          uHead.onclick = () => treeUmschalten('.tree-unter', () => {
            const warOffen = expandedUnters.has(uKey);
            expandedUnters.clear();
            if (!warOffen) expandedUnters.add(uKey);
            return !warOffen;
          }, { unter: uKey });
          uHead.querySelector('.skip-btn').onclick = (e) => { e.stopPropagation(); toggleSkip('unters', uKey); };
          const uDel = uHead.querySelector('.del-btn');
          if (uDel) uDel.onclick = (e) => {
            e.stopPropagation();
            deleteCustomFolderFlow(list, uk, 'unters', uKey);
          };
          body.appendChild(uHead);
          merke('u:' + uKey, uAllDone, uHead.querySelector('.grp-check'));

          if (uExpanded) {
            const uBody = document.createElement('div');
            uBody.className = 'tree-body';
            body.appendChild(uBody);
            for (const n of list) {
              const zeile = await nameRow(n, urls); if (veraltet()) return;
              merke('n:' + n.key, !!n.done, zeile.querySelector('.row-check'));
              uBody.appendChild(zeile);
            }
          }
        } else {
          // Positionen direkt im Oberordner (ohne Unterordner)
          for (const n of list) {
            const zeile = await nameRow(n, urls); if (veraltet()) return;
            merke('n:' + n.key, !!n.done, zeile.querySelector('.row-check'));
            body.appendChild(zeile);
          }
        }
      }
    }
    if (veraltet()) return;
    const altKopf = treeKopf(anker);
    const altTop = altKopf ? altKopf.getBoundingClientRect().top : null;
    tree.replaceChildren(frag);
    revokeThumbs();                        // Bilder des alten Baums jetzt freigeben
    activeUrls = urls;
    if (altTop != null) {
      const neuKopf = treeKopf(anker);
      if (neuKopf) window.scrollBy(0, neuKopf.getBoundingClientRect().top - altTop);
    }
    // Zugeklappte Ordner werden nicht gebaut – ihr Stand bleibt aus dem letzten Aufbau stehen.
    for (const [k, v] of stand) treeStand.set(k, v);
    popEls.forEach(pop);
    if (treeAufgeklappt) {
      const kopf = treeKopf(treeAufgeklappt);
      treeAufgeklappt = null;
      const body = kopf && kopf.nextElementSibling;
      if (body && body.classList.contains('tree-body')) animOpen(body, kopfNachOben(kopf));
      dreheChev(kopf);
    }
  }

  // Neu gezeichnete Kopfzeilen stehen schon „offen" da – den Pfeil trotzdem sichtbar drehen.
  function dreheChev(kopf) {
    const chev = kopf && kopf.querySelector('.chev');
    if (ohneAnimation(chev)) return;
    chev.animate([{ transform: 'none' }, { transform: 'rotate(90deg)' }], { duration: DUR, easing: EASE });
  }

  async function nameRow(n, urls) {
    const origin = originOf(n);
    const row = document.createElement('div');
    row.className = 'name-row' + (n.done ? ' done' : '') + (n.skipped ? ' skipped' : '')
      + (origin ? ' origin-' + origin.cls : '');
    row.dataset.key = n.key;
    const nodeSkip = (skipSet('nodes')).includes(n.key);
    let statusLine;
    if (n.skipped) {
      // Abzeichen auch hier anhängen – sonst verschwindet die Herkunft, sobald eine
      // Position auf „nicht benötigt" steht.
      statusLine = 'nicht benötigt';
    } else {
      statusLine = n.done ? '<span class="row-check">' + Icon('check') + '</span> erledigt' : 'offen';
      // Vom Vorteam übernommene Bilder (per Übergabe-Import): liegen nicht physisch
      // auf diesem Gerät, zählen aber als erledigt. Klar als „Vorteam" kennzeichnen.
      if (n.prior > 0) {
        statusLine += ` <span class="prior-tag" title="bereits vom vorherigen Team erledigt – Bilder liegen beim Vorteam">Vorteam: ${n.prior}</span>`;
      }
    }
    row.innerHTML = `
      <div class="name-head">
        <span class="count-badge">${n.skipped ? '–' : n.ist + '/' + n.pflicht}</span>
        <div class="name-label">${escHtml(n.bildname)}</div>
      </div>
      <div class="name-count">${statusLine}${originTag(n)}</div>
      <div class="thumbs"></div>
      <div class="name-actions">
        <button class="skip-btn" title="${nodeSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}" aria-label="${nodeSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${Icon(nodeSkip ? 'rotate-ccw' : 'circle-slash')}</button>
        <button class="gal-btn" title="Aus Galerie" aria-label="Aus Galerie">${Icon('image')}</button>
        <button class="cam-btn" title="Foto aufnehmen" aria-label="Foto aufnehmen">${Icon('camera')}</button>
        ${origin ? '<button class="del-btn" title="Eigenen Namen löschen" aria-label="Eigenen Namen löschen">' + Icon('trash-2') + '</button>' : ''}
      </div>`;

    row.querySelector('.skip-btn').onclick = () => toggleSkip('nodes', n.key);
    row.querySelector('.cam-btn').onclick = () => pickPhoto(n, true);
    row.querySelector('.gal-btn').onclick = () => pickPhoto(n, false);
    const del = row.querySelector('.del-btn');
    if (del) del.onclick = () => deleteCustomNameFlow(n);

    const thumbs = row.querySelector('.thumbs');
    const photos = await DB.getPhotos(currentJob.id, n.key);
    const bilder = [];      // alle Bilder dieser Position – in der Großansicht durchblätterbar
    for (const p of photos) {
      const url = URL.createObjectURL(p.blob);
      (urls || activeUrls).push(url);
      const wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
      wrap.innerHTML = `<img src="${url}" alt="" loading="lazy" /><span class="thumb-seq">${String(p.seq).padStart(2, '0')}</span>`;
      bilder.push({ photo: p, url, thumb: wrap });
      wrap.onclick = () => openPhotoViewer(n, p, url, bilder);
      thumbs.appendChild(wrap);
    }
    return row;
  }

  // Bild groß anzeigen (damit auf dem Handy erkennbar ist, um welches Bild es geht)
  // mit der Möglichkeit, genau dieses Bild zu löschen.
  // Ab v84.4 Vollbild wie iOS Fotos (js/fotoansicht.js): blättern durch alle Bilder dieser
  // Position (bilder), Wischen nach unten schließt, Zoom. Gelöscht wird das gerade gezeigte Bild.
  function openPhotoViewer(node, photo, url, bilder) {
    const liste = (bilder && bilder.length) ? bilder : [{ photo, url, thumb: null }];
    const start = Math.max(0, liste.findIndex((b) => b.photo.id === photo.id));
    Fotoansicht.oeffnen({
      liste,
      index: start,
      beschriftung: (b) => ({
        titel: node.bildname,
        sub: 'Bild ' + String(b.photo.seq).padStart(2, '0') + (node.unter ? ' · ' + node.unter : '') + ' · ' + node.ober,
      }),
      loeschen: (b) => bildLoeschen(node, b.photo),
    });
  }

  async function bildLoeschen(node, photo) {
    {
      const ok = await openConfirm(
        'Bild löschen?',
        `<p>Bild <b>${String(photo.seq).padStart(2, '0')}</b> von
         „${escHtml(node.bildname)}" wirklich löschen?</p>
         <p class="hint">Das Bild wird endgültig vom Gerät entfernt. Die übrigen Bilder
         dieser Position werden anschließend neu durchnummeriert.</p>`,
        'Löschen', true);
      if (!ok) return;
      // Erst schließen (fliegt ins Vorschaubild zurück), dann löschen und neu aufbauen –
      // der Neuaufbau gibt die Vorschaubilder frei, die die Ansicht noch zeigt.
      await Fotoansicht.schliessen();
      try {
        await Photos.deleteFromNode(node.key, photo.id);
        await renderTree();
        await renderBackupReminder('#backupReminder');
        toast('Bild gelöscht');
      } catch (err) {
        console.error(err);
        toast('Fehler beim Löschen des Bildes');
      }
    }
  }

  // Versteckte File-Inputs (Kamera mit capture, Galerie ohne) gemeinsam genutzt.
  let cameraInput, galleryInput;
  function setupPhotoInputs() {
    cameraInput = document.createElement('input');
    cameraInput.type = 'file';
    cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment';
    cameraInput.hidden = true;
    galleryInput = document.createElement('input');
    galleryInput.type = 'file';
    galleryInput.accept = 'image/*';
    galleryInput.multiple = true;
    galleryInput.hidden = true;
    document.body.append(cameraInput, galleryInput);
    cameraInput.addEventListener('change', onPhotosSelected);
    galleryInput.addEventListener('change', onPhotosSelected);
  }

  function pickPhoto(node, camera) {
    currentNode = node;
    (camera ? cameraInput : galleryInput).click();
  }

  let fotoLaeuft = false;
  async function onPhotosSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // erlaubt erneute Auswahl derselben Datei
    if (!files.length || !currentNode) return;
    // Zwei gleichzeitige Läufe würden dieselbe Bildnummer vergeben (die nächste freie wird
    // aus prior + Anzahl berechnet). Im Export erzeugen zwei Bilder mit gleicher Nummer
    // denselben Pfad – JSZip überschreibt, ein Bild fehlt still in der Sicherung.
    if (fotoLaeuft) { toast('Bitte warten – Bilder werden noch verarbeitet.'); return; }
    // Zielposition festhalten: currentNode ändert sich, sobald der Techniker während der
    // Verarbeitung eine andere Position antippt – die restlichen Bilder landeten sonst dort.
    const zielNode = currentNode;
    fotoLaeuft = true;
    toast(files.length > 1 ? `Verarbeite ${files.length} Bilder…` : 'Verarbeite Bild…');
    try {
      for (const file of files) {
        await Photos.addToNode(zielNode, file);
      }
      await renderTree();
      await renderBackupReminder('#backupReminder');
      toast('Gespeichert');
    } catch (err) {
      console.error(err);
      toast('Bild nicht gespeichert: ' + fehlerText(err), 5000);
    } finally {
      fotoLaeuft = false;
    }
  }

  // ------------------------------------------------- Eigenen Namen anlegen
  async function addCustomNameFlow() {
    const nodes = await Structure.getMerged();
    const obers = Array.from(new Set(nodes.map((n) => n.ober)));
    const oberOptions = [{ value: '__new__', label: '+ Neuer Bereich…' }]
      .concat(obers.map((o) => ({ value: o, label: o })));

    // Unterordner je Bereich – eigene Unterordner stecken in den Custom-Namen und tauchen
    // dadurch beim nächsten Öffnen automatisch hier mit auf.
    const unterOptionen = (ober) => {
      const unters = Array.from(new Set(nodes.filter((n) => n.ober === ober && n.unter).map((n) => n.unter)));
      return [{ value: '__none__', label: '– keiner (direkt im Bereich) –' }]
        .concat(unters.map((u) => ({ value: u, label: u })))
        .concat([{ value: '__new__', label: '+ Neuer Unterordner…' }]);
    };
    const startOber = obers[0] || '__new__';

    openFormModal('Eigenen Namen anlegen', [
      { name: 'oberSelect', label: 'Bereich (Oberordner)', type: 'select', options: oberOptions, value: startOber },
      { name: 'oberNew', label: 'Neuer Bereich', placeholder: 'z. B. 06_Sonstiges' },
      { name: 'unterSelect', label: 'Unterordner (optional)', type: 'select', options: unterOptionen(startOber), value: '__none__' },
      { name: 'unterNew', label: 'Neuer Unterordner', placeholder: 'z. B. Kasse 3' },
      { name: 'bildname', label: 'Bildname', placeholder: 'z. B. Detailaufnahme', required: true },
      { name: 'pflicht', label: 'Pflichtanzahl', type: 'number', value: '1' },
    ], async (data) => {
      let ober = data.oberSelect === '__new__' ? (data.oberNew || '').trim() : data.oberSelect;
      const bildname = (data.bildname || '').trim();
      if (!ober) ober = 'Allgemein';
      if (!bildname) {
        // Dialog bleibt offen; Feld markieren, damit man sieht, was fehlt
        const feld = $('[name="bildname"]', $('#modalBody'));
        feld.classList.add('invalid');
        feld.focus();
        toast('Bitte einen Bildnamen eintragen');
        return false;
      }
      const unter = data.unterSelect === '__new__' ? ((data.unterNew || '').trim() || null)
        : data.unterSelect === '__none__' ? null : data.unterSelect;
      let pflicht = parseInt(data.pflicht, 10);
      if (!Number.isFinite(pflicht) || pflicht < 0) pflicht = 1;
      const node = {
        key: Structure.makeKey(ober, unter, bildname),
        ober, unter, bildname, pflicht, source: 'custom',
      };
      await Structure.addCustomName(node);
      // Den neuen Namen zeigen: Bereich (und Unterordner) aufklappen, hinscrollen, kurz
      // hervorheben. Sonst steht er unsichtbar am Ende eines zugeklappten Ordners.
      expandedObers.clear();
      expandedUnters.clear();
      expandedObers.add(ober);
      if (unter) expandedUnters.add(ober + Structure.SEP + unter);
      await renderTree();
      const zeile = $$('#structureTree .name-row').find((r) => r.dataset.key === node.key);
      if (zeile) {
        zeile.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
        zeile.classList.add('neu-angelegt');
        setTimeout(() => zeile.classList.remove('neu-angelegt'), 2600);
      }
      toast('Name angelegt');
    });

    // Freitextfelder nur zeigen, wenn „Neu…" gewählt ist; Unterordner-Liste folgt dem Bereich.
    const body = $('#modalBody');
    const oberSel = $('[name="oberSelect"]', body);
    const unterSel = $('[name="unterSelect"]', body);
    const zeige = (name, an) => { $(`[name="${name}"]`, body).closest('label').hidden = !an; };
    const aktualisieren = () => {
      zeige('oberNew', oberSel.value === '__new__');
      zeige('unterNew', unterSel.value === '__new__');
    };
    oberSel.addEventListener('change', () => {
      unterSel.innerHTML = unterOptionen(oberSel.value).map((o) =>
        `<option value="${escAttr(o.value)}">${escHtml(o.label)}</option>`).join('');
      unterSel.value = '__none__';
      aktualisieren();
    });
    unterSel.addEventListener('change', () => {
      aktualisieren();
      if (unterSel.value === '__new__') $('[name="unterNew"]', body).focus();
    });
    $('[name="bildname"]', body).addEventListener('input', (e) => e.target.classList.remove('invalid'));
    aktualisieren();
  }

  // -------------------------------------------------- Template importieren
  async function importTemplate(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { nodes, bericht } = await Structure.importFile(file);
      await renderTree();
      populateTemplateSelect(Structure.EXTERNAL_LABEL);
      toast(`Eigene Vorlage importiert: ${nodes.length} Positionen${umzugText(bericht)}`, 4200);
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + (err.message || err));
    }
  }

  // ------------------------------------------------------- Bautagebuch-View
  let diaryDate = null;
  let diaryAutoSaveAktiv = false;
  // true, solange das Datum von der App gesetzt wurde („heute"). Wählt der Techniker im
  // Archiv oder im Datumsfeld einen anderen Tag, steht es auf false – dann darf ihm die
  // App den Tag nicht unter den Händen wegschieben (siehe Mitternachtswechsel unten).
  let diaryDatumAutomatisch = true;
  // Einsatz des Tages (1|2, ab v83.13): Ein Team unterbricht die Arbeit und kommt abends
  // wieder – dafür gibt es ein zweites, getrenntes Bautagebuch für denselben Tag
  // (Excel-Dateiname „_Einsatz2", erste Tätigkeitszeile „2. Einsatz am …", siehe bautagebuch.js).
  let diaryEinsatz = 1;

  // Beim Öffnen der Ansicht immer auf den heutigen Tag stellen.
  // Bis v39 stand hier das Auftragsdatum (`h.datum`), also der Tag, an dem der Auftrag
  // angelegt wurde. Am zweiten Baustellentag öffnete sich damit der ERSTE Tag samt seiner
  // gespeicherten Texte – und das Auto-Speichern schrieb die neuen Eingaben in den alten
  // Tag hinein. Frühere Tage erreicht man weiterhin über das Archiv oder das Datumsfeld.
  function diaryAufHeute() {
    diaryDate = Datum.heute();
    diaryDatumAutomatisch = true;
    diaryNachtschicht = false;
    diaryEinsatz = 1;
  }

  // ---- Nachtschicht (v83.12) ----
  // Eine Schicht über Mitternacht (z. B. 20:00–04:00) steht in EINEM Bautagebuch mit dem
  // Datum des Schichtbeginns; „Ende kleiner als Start" heißt „Ende am Folgetag". Die Vorlage
  // des Auftraggebers darf nicht geändert werden, deshalb vermerkt der Export das Enddatum in
  // der Bemerkung (bautagebuch.js). Das AVL-Tool rechnet Ende < Start schon mit +24 h.
  // Problem ohne diese Logik: Die Techniker tragen meist NACH der Schicht ein. Um 04:00 öffnete
  // die App aber den neuen Tag – der Eintrag landete unter dem falschen Datum.
  const NACHT_BIS_STUNDE = 8;   // bis 08:00 gilt ein Öffnen als „nach der Nachtschicht"
  let diaryNachtschicht = false; // true: Vortag wurde als Nachtschicht geöffnet
  let nachtAntwort = null;       // { tag, datum, einsatz }: Antwort auf die Frage, gilt für diesen Tag

  const endetAmFolgetag = (r) => !!(r.start && r.ende && r.ende < r.start);
  // Vor Mitternacht begonnen und noch offen (oder schon mit Ende nach Mitternacht).
  // Start ab 12:00, damit eine nicht abgeschlossene Tagschicht nicht als Nachtschicht gilt.
  const offeneNachtschicht = (tag) => ((tag && tag.rows) || [])
    .some((r) => r.start && r.start >= '12:00' && (!r.ende || r.ende < r.start));

  // Welcher Tag (und Einsatz) soll beim Öffnen gelten? Liefert { datum, einsatz }.
  async function diaryStarttag() {
    const jetzt = new Date();
    const heute = Datum.heute(jetzt);
    const nurHeute = { datum: heute, einsatz: 1 };
    if (!currentJob || jetzt.getHours() >= NACHT_BIS_STUNDE) return nurHeute;
    if (await DB.getDiary(currentJob.id, heute, 1) || await DB.getDiary(currentJob.id, heute, 2)) {
      return nurHeute;                                              // heute schon begonnen
    }
    const gestern = Datum.plusTage(heute, -1);
    if (nachtAntwort && nachtAntwort.tag === heute) return nachtAntwort;
    // Offene Nachtschicht von gestern – zuerst im Abendeinsatz (2) suchen.
    const g2 = await DB.getDiary(currentJob.id, gestern, 2);
    const g1 = await DB.getDiary(currentJob.id, gestern, 1);
    const offen = offeneNachtschicht(g2) ? 2 : offeneNachtschicht(g1) ? 1 : 0;
    if (offen) {
      toast('Nachtschicht: Bautagebuch vom ' + fmtDate(gestern)
        + (g2 ? ` (${offen}. Einsatz)` : '') + ' geöffnet', 3500);
      return { datum: gestern, einsatz: offen };
    }
    const ja = await openConfirm('Nachtschicht?',
      `<p>Es ist nach Mitternacht. Gehört dein Eintrag zur Schicht von gestern
       (<b>${fmtDate(gestern)}</b>)?</p>
       <p class="hint">Eine Nachtschicht wird mit dem Datum des Schichtbeginns eingetragen.
       Liegt das Ende nach Mitternacht, vermerkt die App das Enddatum in der Bemerkung.</p>`,
      'Ja, Schicht vom ' + fmtDate(gestern).slice(0, 6), false,
      'Nein, heute (' + fmtDate(heute).slice(0, 6) + ')');
    // Ja: den letzten vorhandenen Einsatz von gestern öffnen. War gestern tagsüber schon ein
    // Einsatz, kann der Techniker oben „+ 2. Einsatz an diesem Tag" wählen.
    nachtAntwort = ja ? { tag: heute, datum: gestern, einsatz: g2 ? 2 : 1 }
      : { tag: heute, datum: heute, einsatz: 1 };
    return nachtAntwort;
  }

  // Hinweis unter den Zeiten: „Ende am Folgetag (12.11.2026) – Arbeitszeit 7:30 h".
  function updateFolgetag() {
    for (const d of $$('#diaryRows .diary-row')) {
      const r = { start: timeVal(d.querySelector('.dr-start')), ende: timeVal(d.querySelector('.dr-ende')) };
      const el = d.querySelector('.dr-folgetag');
      if (!el) continue;
      el.hidden = !(endetAmFolgetag(r) && diaryDate);
      if (el.hidden) continue;
      const min = (t) => { const [h, m] = (t || '0:0').split(':').map(Number); return h * 60 + m; };
      const netto = min(r.ende) + 1440 - min(r.start) - min(timeVal(d.querySelector('.dr-pause')));
      el.textContent = `Ende am Folgetag (${fmtDate(Datum.plusTage(diaryDate, 1))}) – Arbeitszeit `
        + `${Math.floor(netto / 60)}:${String(netto % 60).padStart(2, '0')} h. `
        + 'Das Enddatum kommt automatisch in die Bemerkung.';
    }
  }

  async function initDiaryView() {
    const f = $('#diaryForm');
    diaryAufHeute();
    const start = await diaryStarttag();
    if (start.datum !== diaryDate) { diaryDate = start.datum; diaryNachtschicht = true; }
    diaryEinsatz = start.einsatz;
    f.datum.value = diaryDate;
    await loadDiaryForDate(diaryDate, diaryEinsatz);
    await renderDiaryArchive();
    f.datum.onchange = async () => {
      await flushDiary();                 // alten Tag sichern, bevor das Formular umschaltet
      diaryDate = f.datum.value;
      diaryEinsatz = 1;
      diaryDatumAutomatisch = (diaryDate === Datum.heute());
      await loadDiaryForDate(diaryDate, 1);
      await renderDiaryArchive();
    };
    if (!diaryAutoSaveAktiv) {            // Listener nur einmal registrieren
      diaryAutoSaveAktiv = true;
      f.addEventListener('input', scheduleDiarySave);
      bindDiaryRows();
    }
  }

  function fmtDate(datum) {
    if (!datum) return '';
    const [y, m, d] = datum.split('-');
    return `${d}.${m}.${y}`;
  }

  // Liste der gespeicherten Bautagebücher des aktuellen Auftrags (neueste zuerst). Hat ein
  // Tag zwei Einsätze, steht jeder als eigene Zeile da („11.11.2026 · 2. Einsatz").
  async function renderDiaryArchive() {
    const cont = $('#diaryArchive');
    if (!cont || !currentJob) return;
    const days = await DB.listDiary(currentJob.id);
    if (!days.length) {
      cont.innerHTML = '<p class="hint">Noch keine Bautagebücher gespeichert. Trage unten einen Tag ein und tippe „Tag speichern".</p>';
      return;
    }
    const mitZwei = new Set(days.filter((d) => d.einsatz > 1).map((d) => d.datum));
    cont.innerHTML = '';
    for (const day of days) {
      const active = day.datum === diaryDate && day.einsatz === diaryEinsatz;
      const titel = fmtDate(day.datum) + (mitZwei.has(day.datum) ? ` · ${day.einsatz}. Einsatz` : '');
      const snippet = (day.taetigkeiten || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const div = document.createElement('div');
      div.className = 'diary-arch-item' + (active ? ' active' : '');
      div.innerHTML = `<div class="da-main">
          <div class="da-date">${titel}</div>
          <div class="da-snip">${escHtml(snippet || '—')}</div>
        </div>
        <span class="da-go">öffnen ${Icon('chevron-right', 'i-sm')}</span>
        <button class="da-del" title="Löschen" aria-label="Löschen">${Icon('trash-2')}</button>`;
      div.querySelector('.da-main').onclick = async () => {
        await flushDiary();            // aktuellen Tag sichern, bevor ein anderer geladen wird
        diaryDate = day.datum;
        diaryEinsatz = day.einsatz;
        diaryDatumAutomatisch = (diaryDate === Datum.heute());
        $('#diaryForm').datum.value = day.datum;
        await loadDiaryForDate(day.datum, day.einsatz);
        await renderDiaryArchive();
        window.scrollTo(0, 0);
        toast(titel + ' geladen – bearbeitbar');
      };
      div.querySelector('.da-go').onclick = div.querySelector('.da-main').onclick;
      div.querySelector('.da-del').onclick = (e) => { e.stopPropagation(); deleteDiaryFlow(day, mitZwei.has(day.datum)); };
      cont.appendChild(div);
    }
  }

  // Löschen eines Einsatzes. Wird der 1. gelöscht, während ein 2. existiert, rückt der 2.
  // nach (wird zum 1.) – sonst stünde ein „2. Einsatz" ohne ersten da.
  async function deleteDiaryFlow(day, zweiEinsaetze) {
    const titel = fmtDate(day.datum) + (zweiEinsaetze ? ` (${day.einsatz}. Einsatz)` : '');
    const nachruecken = zweiEinsaetze && day.einsatz === 1;
    const ok = await openConfirm(
      zweiEinsaetze ? 'Einsatz löschen?' : 'Bautagebuch-Tag löschen?',
      `<p><b>${titel}</b> wirklich löschen?</p>
       ${nachruecken ? '<p>Der 2. Einsatz dieses Tages wird danach zum 1. Einsatz.</p>' : ''}
       <p class="hint">Die Eingaben werden entfernt. Das kann nicht rückgängig gemacht werden.</p>`,
      'Löschen', true);
    if (!ok) return;
    clearTimeout(diarySaveTimer);      // kein verspätetes Auto-Speichern des gelöschten Einsatzes
    await DB.deleteDiary(currentJob.id, day.datum, day.einsatz);
    if (nachruecken) {
      const zwei = await DB.getDiary(currentJob.id, day.datum, 2);
      if (zwei) {
        await DB.saveDiary(currentJob.id, Object.assign({}, zwei, { einsatz: 1 }));
        await DB.deleteDiary(currentJob.id, day.datum, 2);
      }
    }
    if (day.datum === diaryDate) {
      if (diaryEinsatz === 2 && (nachruecken || day.einsatz === 2)) diaryEinsatz = 1;
      await loadDiaryForDate(diaryDate, diaryEinsatz); // Formular leeren/auffrischen
    }
    await renderDiaryArchive();
    toast(titel + ' gelöscht');
  }

  // Umschalter unter dem Datum: „+ 2. Einsatz an diesem Tag" (sobald der 1. gespeichert ist)
  // bzw. „1. Einsatz | 2. Einsatz", wenn es einen zweiten gibt oder er gerade offen ist.
  async function renderEinsatzLeiste() {
    const box = $('#diaryEinsatz');
    if (!box || !currentJob || !diaryDate) return;
    const e1 = await DB.getDiary(currentJob.id, diaryDate, 1);
    const e2 = await DB.getDiary(currentJob.id, diaryDate, 2);
    if (e2 || diaryEinsatz === 2) {
      box.innerHTML = [1, 2].map((n) => `<button type="button" class="de-tab${n === diaryEinsatz ? ' active' : ''}"
        data-einsatz="${n}" aria-pressed="${n === diaryEinsatz}">${n}. Einsatz</button>`).join('');
      box.hidden = false;
    } else if (e1) {
      box.innerHTML = '<button type="button" class="btn ghost wide de-neu" data-einsatz="2">+ 2. Einsatz an diesem Tag</button>';
      box.hidden = false;
    } else {
      box.innerHTML = '';
      box.hidden = true;
    }
    box.onclick = (e) => {
      const b = e.target.closest('[data-einsatz]');
      if (b) wechsleEinsatz(+b.dataset.einsatz);
    };
  }

  async function wechsleEinsatz(n) {
    if (n === diaryEinsatz) return;
    await flushDiary();                 // offenen Einsatz sichern, bevor umgeschaltet wird
    diaryEinsatz = n;
    await loadDiaryForDate(diaryDate, n);
    await renderDiaryArchive();
    if (n === 2) toast('2. Einsatz: eigenes Bautagebuch für denselben Tag');
  }

  async function loadDiaryForDate(datum, einsatz) {
    const f = $('#diaryForm');
    const nr = einsatz || 1;
    const saved = await DB.getDiary(currentJob.id, datum, nr);
    const techs = (currentJob && currentJob.header && currentJob.header.techniker) || [];

    if (saved) {
      f.anzTechniker.value = (saved.anzTechniker != null) ? saved.anzTechniker : techs.length;
      f.taetigkeiten.value = saved.taetigkeiten || '';
      f.behinderungen.value = saved.behinderungen || '';
      f.vorkommnisse.value = saved.vorkommnisse || '';
      f.ortDatum.value = saved.ortDatum || defaultOrtDatum(datum);
      renderDiaryRows(saved.rows || techs.map((t) => ({ name: t })));
    } else {
      // Neuer 2. Einsatz: meist dasselbe Team – Namen (und Anzahl) aus dem 1. Einsatz
      // vorbelegen, Zeiten und Texte bleiben leer.
      const e1 = nr > 1 ? await DB.getDiary(currentJob.id, datum, 1) : null;
      const namen = e1 && (e1.rows || []).filter((r) => r.name || r.name2)
        .map((r) => ({ name: r.name || '', name2: r.name2 || '' }));
      f.anzTechniker.value = e1 && e1.anzTechniker != null ? e1.anzTechniker : (techs.length || '');
      f.taetigkeiten.value = '';
      f.behinderungen.value = '';
      f.vorkommnisse.value = '';
      f.ortDatum.value = defaultOrtDatum(datum);
      renderDiaryRows(namen && namen.length ? namen : techs.map((t) => ({ name: t })));
    }
    korrekturVorher = null;
    $('#diaryKorrUndo').hidden = true;
    await renderEinsatzLeiste();
  }

  // ---- Texte korrigieren (regelbasiert, js/textkorrektur.js) ----
  // Zeigt je Textfeld Original und Vorschlag mit markierten Änderungen; der Techniker
  // wählt, was übernommen wird. Die Originale bleiben bis zum Tageswechsel für
  // „Korrektur rückgängig" erhalten.
  const KORR_FELDER = [
    ['taetigkeiten', 'Beschreibung der Tätigkeiten'],
    ['behinderungen', 'Behinderungen'],
    ['vorkommnisse', 'Besondere Vorkommnisse'],
  ];
  let korrekturVorher = null;

  // Wort-Diff (LCS über Wörter und Leerraum): zeigt den neuen Text, geänderte/neue Wörter
  // hervorgehoben. Gelöschte Wörter werden nicht eingeblendet – auf dem Handy wäre der
  // Text sonst kaum lesbar; das Original ist im Dialog aufklappbar.
  function wortDiffHtml(alt, neu) {
    const a = alt.split(/(\s+)/).filter((t) => t !== '');
    const b = neu.split(/(\s+)/).filter((t) => t !== '');
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    const leer = (t) => /^\s+$/.test(t);
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { out.push(escHtml(b[j])); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) {
        out.push(leer(b[j]) ? escHtml(b[j]) : `<ins>${escHtml(b[j])}</ins>`); j++;
      } else {
        i++;
      }
    }
    return out.join('');
  }

  function openTextkorrektur() {
    const f = $('#diaryForm');
    const vorschlaege = KORR_FELDER.map(([name, titel]) => {
      const alt = f[name].value;
      const erg = Textkorrektur.korrigiere(alt, name);
      return { name, titel, alt, neu: erg.text, hinweise: erg.hinweise, geaendert: alt.trim() !== '' && erg.text !== alt };
    });
    if (vorschlaege.every((v) => !v.alt.trim())) {
      toast('Noch kein Text eingetragen.');
      return;
    }
    if (!vorschlaege.some((v) => v.geaendert)) {
      toast('Keine Korrektur nötig – die Texte entsprechen bereits den Regeln.');
      return;
    }
    const html = '<p class="tk-info">Vorschlag nach den hinterlegten Schreibregeln (ohne KI). '
      + '<ins>Markiert</ins> = geändert. Bitte inhaltlich gegenlesen – '
      + 'nach dem Übernehmen kann im Feld weiter geändert werden.</p>'
      + vorschlaege.filter((v) => v.alt.trim()).map((v) => `
        <div class="tk-feld">
          <label class="tk-wahl"><input type="checkbox" name="${v.name}" ${v.geaendert ? 'checked' : 'disabled'} />
            ${escHtml(v.titel)}${v.geaendert ? '' : ' – keine Änderung'}</label>
          ${v.geaendert ? `<div class="tk-diff">${wortDiffHtml(v.alt, v.neu)}</div>
            <details class="tk-orig"><summary>Original anzeigen</summary><div>${escHtml(v.alt)}</div></details>` : ''}
          ${v.hinweise.length ? `<ul class="tk-hinweise">${v.hinweise.map((h) => `<li>${escHtml(h)}</li>`).join('')}</ul>` : ''}
        </div>`).join('');
    openConfirm('Texte korrigieren', html, 'Auswahl übernehmen', false, 'Verwerfen').then((ok) => {
      if (!ok) return;
      // Häkchen wurden vor dem Schließen gesetzt – Body ist noch im DOM
      const gewaehlt = vorschlaege.filter((v) => v.geaendert && $(`#modalBody input[name="${v.name}"]`)?.checked);
      if (!gewaehlt.length) return;
      korrekturVorher = {};
      gewaehlt.forEach((v) => { korrekturVorher[v.name] = v.alt; f[v.name].value = v.neu; });
      $('#diaryKorrUndo').hidden = false;
      toast('Korrektur übernommen – bitte gegenlesen und Tag speichern.');
    });
  }

  function undoTextkorrektur() {
    if (!korrekturVorher) return;
    const f = $('#diaryForm');
    Object.entries(korrekturVorher).forEach(([name, alt]) => { f[name].value = alt; });
    korrekturVorher = null;
    $('#diaryKorrUndo').hidden = true;
    toast('Originaltexte wiederhergestellt.');
  }

  function defaultOrtDatum(datum) {
    const ort = (currentJob && currentJob.header && currentJob.header.ort) || '';
    if (!datum) return ort;
    const [y, m, d] = datum.split('-');
    return `${ort} ${d}.${m}.${y}`.trim();
  }

  // ------------------------------------------------ Bautagebuch: Techniker-Blöcke
  // Die Excel-Vorlage des Auftraggebers hat genau 5 Techniker-Zeilen (darf nicht geändert
  // werden). Techniker 1 und 2 sind immer eingeblendet, 3–5 kommen per Knopf dazu. Sind mehr
  // als 5 Leute vor Ort, trägt man je Block einen 2. Namen mit identischen Zeiten ein
  // (Excel: „Müller + Schmidt"). Dieser Knopf erscheint erst, wenn alle 5 Blöcke belegt
  // sind – sonst verwechselt man ihn leicht mit „+ Techniker hinzufügen".
  const MAX_TECH = 5;
  const MIN_TECH = 2;
  const TIME_FIELDS = ['.dr-start', '.dr-ende', '.dr-pause'];

  // Uhrzeit aus der Eingabe: „7" → 07:00, „730"/„0730"/„7:30"/„7.30" → 07:30. Bei der Pause
  // sind 1–2 Ziffern Minuten („30" → 00:30, „90" → 01:30). Liefert '' (leer), 'HH:MM' oder
  // null (ungültig). Statt <input type="time">: Dort zeigt Android keine Tastatur, und ohne
  // sichtbares Uhr-Symbol ließ sich bis v55 auf schmalen Handys gar keine Zeit eingeben.
  function normalizeTime(raw, pause) {
    const s = String(raw || '').trim();
    if (!s) return '';
    let h, m;
    const sep = s.match(/^(\d{1,2})\s*[:.,]\s*(\d{2})$/);
    if (sep) {
      h = +sep[1]; m = +sep[2];
    } else if (/^\d{1,4}$/.test(s)) {
      if (s.length <= 2) {
        if (pause) { h = Math.floor(+s / 60); m = +s % 60; } else { h = +s; m = 0; }
      } else {
        h = +s.slice(0, -2); m = +s.slice(-2);
      }
    } else {
      return null;
    }
    if (h > 23 || m > 59) return null;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  const istPause = (inp) => inp.classList.contains('dr-pause');
  const timeVal = (inp) => normalizeTime(inp.value, istPause(inp)) || '';

  const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function timeFieldHtml(cls, label, value) {
    return `<div class="dr-time">
        <span class="dr-time-label">${label}</span>
        <span class="dr-time-box">
          <input class="${cls}" type="text" inputmode="numeric" autocomplete="off" maxlength="5"
                 placeholder="hh:mm" aria-label="${label}" value="${escAttr(value || '')}" />
          <button type="button" class="dr-clock" title="Uhrzeit auswählen" aria-label="${label}: Uhrzeit auswählen">${CLOCK_SVG}</button>
          <input class="dr-picker" type="time" tabindex="-1" aria-hidden="true" />
        </span>
      </div>`;
  }

  function diaryRowEl(r) {
    const div = document.createElement('div');
    div.className = 'diary-row';
    const name2 = r.name2 || '';
    div.innerHTML = `
      <div class="dr-head">
        <span class="dr-title"></span>
        <button type="button" class="dr-del" title="Techniker entfernen" aria-label="Techniker entfernen">${Icon('x')}</button>
      </div>
      <input class="dr-name" type="text" placeholder="Name" value="${escAttr(r.name || '')}" autocomplete="off" />
      <input class="dr-name2" type="text" placeholder="2. Techniker (gleiche Zeiten)" value="${escAttr(name2)}" autocomplete="off"${name2 ? '' : ' hidden'} />
      <button type="button" class="dr-add2" hidden>+ 2. Techniker (gleiche Zeiten)</button>
      <button type="button" class="btn ghost dr-copy">${Icon('copy')} Zeiten von Techniker 1 übernehmen</button>
      <div class="dr-times">
        ${timeFieldHtml('dr-start', 'Start', r.start)}
        ${timeFieldHtml('dr-ende', 'Ende', r.ende)}
        ${timeFieldHtml('dr-pause', 'Pause', r.pause)}
      </div>
      <p class="dr-folgetag" hidden></p>
      <textarea class="dr-bem" rows="1" placeholder="Bemerkung">${escHtml(r.bemerkung || '')}</textarea>`;
    // Namensauswahl aus der Technikerliste; wer am selben Tag schon eingetragen ist, fehlt dort.
    for (const feld of div.querySelectorAll('.dr-name, .dr-name2')) {
      Namen.anbinden(feld, { ausblenden: () => $$('#diaryRows .dr-name, #diaryRows .dr-name2')
        .filter((x) => x !== feld).map((x) => x.value) });
    }
    return div;
  }

  function renderDiaryRows(rows) {
    const cont = $('#diaryRows');
    cont.innerHTML = '';
    const data = (rows || []).slice(0, MAX_TECH);
    while (data.length < MIN_TECH) data.push({});
    data.forEach((r) => cont.appendChild(diaryRowEl(r)));
    renumberDiaryRows();
  }

  // Nummern, ✕ (erst ab Techniker 3), Übernehmen-Knopf (ab Techniker 2) und
  // „+ Techniker hinzufügen" (bis 5) nach jedem Hinzufügen/Entfernen neu setzen.
  function renumberDiaryRows() {
    const rows = $$('#diaryRows .diary-row');
    rows.forEach((d, i) => {
      d.querySelector('.dr-title').textContent = 'Techniker ' + (i + 1);
      d.querySelector('.dr-del').hidden = i < MIN_TECH;
      d.querySelector('.dr-copy').hidden = i === 0;
    });
    const add = $('#diaryAddRow');
    if (add) add.hidden = rows.length >= MAX_TECH;
    updateZweitname();
    updateFolgetag();
  }

  // „+ 2. Techniker" nur, wenn alle 5 Blöcke Name + Start + Ende haben (Pause darf fehlen).
  // Ein schon eingetragener 2. Name bleibt immer sichtbar; ein leeres, geöffnetes Feld wird
  // wieder eingeklappt, sobald die Bedingung wegfällt.
  function updateZweitname() {
    const rows = $$('#diaryRows .diary-row');
    const voll = rows.length === MAX_TECH && rows.every((d) => d.querySelector('.dr-name').value.trim()
      && timeVal(d.querySelector('.dr-start')) && timeVal(d.querySelector('.dr-ende')));
    rows.forEach((d) => {
      const n2 = d.querySelector('.dr-name2');
      if (!voll && !n2.value.trim() && document.activeElement !== n2) n2.hidden = true;
      d.querySelector('.dr-add2').hidden = !voll || !n2.hidden;
    });
  }

  function commitTime(inp) {
    const v = normalizeTime(inp.value, istPause(inp));
    if (v === null) {
      inp.classList.add('invalid');
      toast('Ungültige Uhrzeit – bitte z. B. 0730 oder 07:30 eingeben.');
      return;
    }
    inp.classList.remove('invalid');
    inp.value = v;
  }

  function openTimePicker(box) {
    const txt = box.querySelector('input[type="text"]');
    const picker = box.querySelector('.dr-picker');
    picker.value = timeVal(txt);
    try {
      if (typeof picker.showPicker === 'function') { picker.showPicker(); return; }
    } catch (e) { /* Fallback unten */ }
    picker.focus();
    picker.click();
  }

  async function copyTimesFromFirst(row) {
    const first = $$('#diaryRows .diary-row')[0];
    const src = TIME_FIELDS.map((s) => timeVal(first.querySelector(s)));
    if (!src.some(Boolean)) { toast('Bei Techniker 1 sind noch keine Zeiten eingetragen.'); return; }
    const ziel = TIME_FIELDS.map((s) => row.querySelector(s).value.trim());
    const gleich = ziel.every((v, k) => normalizeTime(v, k === 2) === src[k]);
    if (!gleich && ziel.some(Boolean)) {
      const ok = await openConfirm('Zeiten ersetzen?',
        '<p>Bei diesem Techniker stehen schon Zeiten. Durch die Zeiten von Techniker 1 ersetzen?</p>', 'Ersetzen');
      if (!ok) return;
    }
    TIME_FIELDS.forEach((s, k) => {
      const inp = row.querySelector(s);
      inp.value = src[k];
      inp.classList.remove('invalid');
    });
    scheduleDiarySave();
    updateZweitname();
    // Ohne diesen Aufruf blieb ein „Ende am Folgetag"-Hinweis aus einer vorherigen Eingabe
    // stehen, obwohl die übernommenen Zeiten am selben Tag enden (v83.15, Fund von Michael).
    updateFolgetag();
    toast('Zeiten von Techniker 1 übernommen');
  }

  async function removeDiaryRow(row) {
    const hatInhalt = $$('input[type="text"], textarea', row).some((e) => e.value.trim());
    if (hatInhalt) {
      const ok = await openConfirm('Techniker entfernen?',
        '<p>Name, Zeiten und Bemerkung dieses Technikers werden gelöscht.</p>', 'Entfernen', true);
      if (!ok) return;
    }
    row.remove();
    renumberDiaryRows();
    scheduleDiarySave();
  }

  function addDiaryRow() {
    const cont = $('#diaryRows');
    if ($$('.diary-row', cont).length >= MAX_TECH) return;
    const row = diaryRowEl({});
    cont.appendChild(row);
    renumberDiaryRows();
    row.querySelector('.dr-name').focus();
  }

  // Einmalig: alle Knöpfe/Felder der Techniker-Blöcke über Delegation an #diaryRows.
  function bindDiaryRows() {
    const cont = $('#diaryRows');
    cont.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn || !cont.contains(btn)) return;
      const row = btn.closest('.diary-row');
      if (btn.classList.contains('dr-clock')) openTimePicker(btn.closest('.dr-time-box'));
      else if (btn.classList.contains('dr-copy')) copyTimesFromFirst(row);
      else if (btn.classList.contains('dr-del')) removeDiaryRow(row);
      else if (btn.classList.contains('dr-add2')) {
        const n2 = row.querySelector('.dr-name2');
        n2.hidden = false;
        btn.hidden = true;
        n2.focus();
      }
    });
    cont.addEventListener('change', (e) => {
      const t = e.target;
      if (t.classList.contains('dr-picker')) {
        const txt = t.closest('.dr-time-box').querySelector('input[type="text"]');
        txt.value = t.value;
        txt.classList.remove('invalid');
        scheduleDiarySave();
      } else if (TIME_FIELDS.some((s) => t.matches(s))) {
        commitTime(t);
      }
      updateZweitname();
      updateFolgetag();
    });
    cont.addEventListener('input', (e) => {
      if (e.target.classList.contains('invalid')) e.target.classList.remove('invalid');
      updateZweitname();
      updateFolgetag();
    });
    const add = $('#diaryAddRow');
    if (add) add.onclick = addDiaryRow;
  }

  function gatherDiary() {
    const f = $('#diaryForm');
    const rows = $$('#diaryRows .diary-row').map((d) => ({
      name: d.querySelector('.dr-name').value.trim(),
      name2: d.querySelector('.dr-name2').value.trim(),
      start: timeVal(d.querySelector('.dr-start')),
      ende: timeVal(d.querySelector('.dr-ende')),
      pause: timeVal(d.querySelector('.dr-pause')),
      bemerkung: d.querySelector('.dr-bem').value.trim(),
    })).filter((r) => r.name || r.name2 || r.start || r.ende || r.pause || r.bemerkung);

    return {
      datum: f.datum.value,
      einsatz: diaryEinsatz,
      anzTechniker: f.anzTechniker.value,
      rows,
      taetigkeiten: f.taetigkeiten.value,
      behinderungen: f.behinderungen.value,
      vorkommnisse: f.vorkommnisse.value,
      ortDatum: f.ortDatum.value.trim(),
    };
  }

  // Speichert den aktuellen Formularstand automatisch. Bis v38 ging ein kompletter
  // Bautagebuch-Tag verloren, wenn statt „💾 Tag speichern" der Zurück-Pfeil getippt oder
  // das Datum gewechselt wurde – das Formular wurde dabei kommentarlos überschrieben.
  // datumFuer: unter welchem Tag gespeichert wird. Beim Datumswechsel steht im Feld bereits
  // das NEUE Datum, gespeichert werden muss aber der alte Tag.
  async function autoSaveDiary(datumFuer, einsatzFuer) {
    if (!currentJob) return false;
    const f = $('#diaryForm');
    if (!f || !f.datum) return false;
    const model = gatherDiary();
    if (datumFuer) model.datum = datumFuer;
    if (einsatzFuer) model.einsatz = einsatzFuer;
    if (!model.datum) return false;
    // Ein unberührtes Formular soll keinen leeren Archiv-Eintrag anlegen. „ortDatum" und
    // „anzTechniker" zählen nicht als Inhalt – beide sind vorbelegt.
    const hatInhalt = model.rows.length || model.taetigkeiten.trim()
      || model.behinderungen.trim() || model.vorkommnisse.trim();
    if (!hatInhalt) return false;
    await DB.saveDiary(currentJob.id, model);
    return true;
  }

  let diarySaveTimer = null;
  function scheduleDiarySave() {
    clearTimeout(diarySaveTimer);
    diarySaveTimer = setTimeout(() => {
      autoSaveDiary(diaryDate, diaryEinsatz)
        // Nach dem ersten Speichern des 1. Einsatzes erscheint „+ 2. Einsatz an diesem Tag".
        .then((ok) => { if (ok && $('#diaryEinsatz').hidden) renderEinsatzLeiste(); })
        .catch((e) => console.warn('Auto-Speichern fehlgeschlagen', e));
    }, 800);
  }

  // Sofort sichern (Ansicht wird verlassen, App geht in den Hintergrund).
  async function flushDiary() {
    clearTimeout(diarySaveTimer);
    try { await autoSaveDiary(diaryDate, diaryEinsatz); } catch (e) { console.warn('Auto-Speichern fehlgeschlagen', e); }
  }

  // Zahl der eingetragenen Personen: Name und 2. Name zählen je für sich; „A + B" in einem
  // Feld (so wurde es vor v56 gemacht) zählt ebenfalls als 2.
  function zaehleNamen(rows) {
    const teile = (s) => String(s || '').split('+').map((t) => t.trim()).filter(Boolean).length;
    return (rows || []).reduce((n, r) => n + teile(r.name) + teile(r.name2), 0);
  }

  // „Anz. Techniker" bleibt bewusst manuell (es können mehr Leute vor Ort sein, als Zeilen
  // ausgefüllt sind). Weicht die Zahl von den eingetragenen Namen ab, gibt es deshalb nur
  // einen Hinweis mit „Trotzdem" – keine Sperre. Liefert true = weitermachen.
  async function pruefeAnzahlTechniker(model, aktion) {
    const namen = zaehleNamen(model.rows);
    const roh = String(model.anzTechniker == null ? '' : model.anzTechniker).trim();
    const anz = roh === '' ? null : parseInt(roh, 10);
    if (anz === namen || (anz === null && namen === 0)) return true;
    const links = anz === null ? '„Anz. Techniker“ ist leer' : `„Anz. Techniker“ ist <b>${anz}</b>`;
    const rechts = namen === 1 ? 'eingetragen ist <b>1 Name</b>' : `eingetragen sind <b>${namen} Namen</b>`;
    const ok = await openConfirm('Anzahl Techniker prüfen',
      `<p>${links}, ${rechts}.</p><p>Trotzdem ${aktion}?</p>`, 'Trotzdem', false, 'Korrigieren');
    if (!ok) {
      const feld = $('#diaryForm').anzTechniker;
      feld.scrollIntoView({ behavior: sanft(), block: 'center' });
      feld.focus();
    }
    return ok;
  }

  async function saveDiary() {
    const model = gatherDiary();
    if (!model.datum) { toast('Datum fehlt'); return; }
    if (!(await pruefeAnzahlTechniker(model, 'speichern'))) return;
    await DB.saveDiary(currentJob.id, model);
    await renderDiaryArchive();
    await renderEinsatzLeiste();
    const s = $('#diarySaved');
    s.hidden = false; setTimeout(() => { s.hidden = true; }, 2000);
    toast('Tag gespeichert');
  }

  async function exportDiary() {
    const model = gatherDiary();
    if (!model.datum) { toast('Datum fehlt'); return; }
    if (!(await pruefeAnzahlTechniker(model, 'exportieren'))) return;
    await DB.saveDiary(currentJob.id, model); // immer mitspeichern
    await renderDiaryArchive();
    await renderEinsatzLeiste();
    const h = (currentJob && currentJob.header) || {};
    const full = Object.assign({}, model, {
      filiale: h.filiale || '',
      ort: h.ort || '',
      beauftragung: h.beauftragung || 'NFK Vollverkabelung',
    });
    try {
      const name = await Bautagebuch.exportFile(full);
      toast('Bautagebuch erstellt');
    } catch (err) {
      console.error(err);
      toast('Export fehlgeschlagen: ' + (err.message || err));
    }
  }

  // ------------------------------------------------------------------- Init
  function bindEvents() {
    $('#backBtn').onclick = () => history.back();
    // Zur zuletzt verlassenen Ansicht zurück, nicht pauschal zur Startseite: sonst blieben
    // gepushte Einträge im Verlauf liegen und der Android-Zurück-Button wirkte mehrfach
    // wirkungslos, bevor die App schloss.
    window.addEventListener('popstate', (e) => {
      // Offene Fotoansicht: Zurück schließt nur sie (siehe Fotoansicht.zurueckTaste).
      if (typeof Fotoansicht !== 'undefined' && Fotoansicht.zurueckTaste()) return;
      // Offenes Info-Fenster (Übersicht): Zurück schließt nur das Fenster.
      if (infoZurueckTaste()) return;
      let ziel = (e.state && e.state.nfk) ? e.state.nfk : 'view-start';
      // Verlaufseinträge stammen evtl. von einem vorher geöffneten Auftrag – ohne gespeicherte
      // Stammdaten führt auch der Verlauf nicht in einen Arbeitsbereich.
      if (ziel !== 'view-start' && fehlendeStammdaten(currentJob).length) ziel = 'view-start';
      _switchView(ziel, true);
    });
    // Android friert die App beim Wegwischen ein oder beendet sie – vorher noch sichern.
    const alleSichern = () => { flushDiary(); Vorpruefung.flush(); Wochenbericht.flush(); };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { alleSichern(); return; }
      // Die App wird zurückgeholt: Liegt das Bautagebuch noch offen und ist inzwischen ein
      // neuer Tag angebrochen (Handy über Nacht gesperrt), auf den heutigen Tag umstellen.
      // Nur, wenn das Datum von der App gesetzt war – einen bewusst gewählten Archivtag
      // lässt sie stehen.
      // Eine bewusst geöffnete Nachtschicht (Vortag) bleibt am Folgetag stehen, bis die
      // Ansicht neu geöffnet wird – sonst spränge sie beim Entsperren um 08:30 weg.
      if (aktiveView === 'view-bautagebuch' && diaryDatumAutomatisch
          && diaryDate !== Datum.heute()
          && !(diaryNachtschicht && Datum.plusTage(diaryDate, 1) === Datum.heute())) {
        // Erst den bisherigen Tag sichern (flushDiary arbeitet noch mit dem alten
        // diaryDate), dann umstellen – sonst ginge eine offene Eingabe verloren.
        flushDiary()
          .then(initDiaryView)
          .catch((e) => console.warn('Bautagebuch-Datum konnte nicht aktualisiert werden', e));
      }
    });
    window.addEventListener('pagehide', alleSichern);
    $$('[data-go]').forEach((b) => b.onclick = () => goGuard(b.dataset.go));
    $('#projectForm').addEventListener('submit', saveProjectForm);
    $('#newJobBtn').onclick = newJobFlow;
    $('#importTemplate').addEventListener('change', importTemplate);
    $('#templateSelect').addEventListener('change', onTemplateChange);
    $('#templateSelect').addEventListener('change', passeVorlagenSchrift);
    $('#tplRefreshBtn').onclick = refreshCatalog;
    $('#addCustomBtn').onclick = addCustomNameFlow;
    $('#overviewBtn').onclick = () => Overview.show();
    // ZIP-Export = vollständige Sicherung: über doBackupNow, damit der Zeitpunkt
    // gemerkt und die Backup-Erinnerung aktualisiert wird.
    $('#exportZipBtn').onclick = busy(doBackupNow);
    // Nimmt beides an (.xlsx wie .zip) – importAnyFile entscheidet. Die früheren Knöpfe
    // „Übergabe export/import" sind seit v84.5 entfallen (ZIP enthält die Übergabe-Datei).
    $('#mergeImport').addEventListener('change', importAnyFile);
    // Derselbe Import auch auf der Startseite: die Knöpfe in der Bilddoku sind ohne
    // gespeicherte Stammdaten gesperrt – auf einem frischen Handy käme man sonst nie an
    // die Übergabe des Kollegen heran.
    $('#startImport').addEventListener('change', importAnyFile);
    $('#diarySaveBtn').onclick = saveDiary;
    $('#diaryKorrBtn').onclick = openTextkorrektur;
    $('#diaryKorrUndo').onclick = undoTextkorrektur;
    $('#diaryExportBtn').onclick = busy(exportDiary);
    // Schatten unter der Kopfleiste, sobald darunter gescrollt wird.
    const topbar = $('.topbar');
    const schatten = () => topbar.classList.toggle('scrolled', window.scrollY > 4);
    window.addEventListener('scroll', schatten, { passive: true });
    schatten();
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') closeOverlay(e.currentTarget);
    });
  }

  function updateNetDot() {
    $('#netDot').classList.toggle('offline', !navigator.onLine);
  }

  // Zeigt unten auf der Startseite die installierte App-Version an. Autoritativ ist
  // die Cache-Version des laufenden Service Workers (per Nachricht abgefragt); solange
  // die noch nicht geantwortet hat, dient APP_VERSION als Sofort-Anzeige/Fallback.
  const APP_VERSION = 'v84.11'; // Mit CACHE in sw.js ändern: v81 -> v82 nur bei neuen Funktionen (Doku), sonst v81.1, v81.2 …
  function renderAppVersion(v) {
    const el = $('#appVersion');
    if (!el) return;
    const clean = String(v || APP_VERSION).replace('nfk-doku-', '');
    el.textContent = 'Version ' + clean;
  }
  // Angezeigt wird IMMER die Version des gerade laufenden JavaScript-Codes (APP_VERSION),
   // nicht die des Service Workers: Der übernimmt per skipWaiting sofort, während die
   // geöffnete Seite weiterhin den alten Code ausführt. Bis v38 stand deshalb schon die neue
   // Nummer da, obwohl noch die alte Fassung lief – der Techniker meldete Fehler gegen eine
   // Version, die er gar nicht benutzte. Ein erkanntes Update wird jetzt stattdessen als
   // Hinweis ausgegeben.
  function initAppVersion() {
    renderAppVersion();
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'VERSION') {
        const neu = String(e.data.version || '').replace('nfk-doku-', '');
        if (neu && neu !== APP_VERSION) {
          const el = $('#appVersion');
          if (el) el.textContent = 'Version ' + APP_VERSION + ' – Update ' + neu + ' bereit';
          toast('Neue Version ' + neu + ' geladen – App einmal schließen und neu öffnen.', 6000);
        }
      }
    });
    const frage = () => {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('GET_VERSION');
    };
    navigator.serviceWorker.addEventListener('controllerchange', frage);
    frage();
  }

  // ---- Warnung: App läuft nicht vom Startbildschirm ----
  // Auf dem iPhone löscht iOS die Daten einer nur in Safari geöffneten Seite nach etwa einer
  // Woche ohne Nutzung – mit allen Fotos und Aufträgen. Für installierte Apps gilt das nicht.
  // Außerdem hat die installierte App eigene Daten, getrennt vom Browser. Deshalb auf Handys
  // deutlich darauf hinweisen (übernommen aus der Auftragsdoku-App, dort im Einsatz bewährt).
  function laeuftAlsApp() {
    // display-mode deckt Android/Chrome ab, navigator.standalone das iPhone.
    try { if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) { /* egal */ }
    return navigator.standalone === true;
  }
  function istApple() {
    // iPadOS ab 13 meldet sich als Mac – erkennbar daran, dass es Touch kann.
    return /iP(hone|ad|od)/.test(navigator.userAgent)
      || (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  const INSTALL_TEXT = {
    ios: '<b>Die App läuft gerade als Safari-Seite.</b> Fotos und Aufträge liegen nur auf diesem '
      + 'Gerät – iOS löscht sie nach etwa einer Woche ohne Nutzung. Jetzt eine Sicherung (ZIP) machen. '
      + 'Danach: Teilen-Symbol antippen → „Zum Home-Bildschirm“ und die App künftig nur noch von dort '
      + 'starten. Achtung: Die installierte App hat eigene Daten – Aufträge über „Auftrag übernehmen“ '
      + 'aus der Sicherung einlesen.',
    android: '<b>Die App läuft gerade als Browser-Seite.</b> Fotos und Aufträge liegen nur in diesem '
      + 'Browser. Jetzt eine Sicherung (ZIP) machen. Danach: Browser-Menü (⋮) → „App installieren“ '
      + 'bzw. „Zum Startbildschirm hinzufügen“ und die App künftig nur noch vom Startbildschirm starten.',
  };
  function pruefeInstallation() {
    const box = $('#installHinweis');
    if (!box) return;
    // Nur auf Handys warnen – am PC ist das Arbeiten im Browser gewollt.
    const mobil = istApple() || /Android/.test(navigator.userAgent);
    // Weggeklickt gilt bis morgen, nicht für immer: Wer wochenlang im Browser arbeitet, soll
    // regelmäßig erinnert werden.
    let weggeklickt = false;
    try { weggeklickt = Date.now() < +(localStorage.getItem('installHinweisZuBis') || 0); } catch (e) { /* egal */ }
    if (!mobil || laeuftAlsApp() || weggeklickt) { box.hidden = true; return; }
    $('#installText').innerHTML = istApple() ? INSTALL_TEXT.ios : INSTALL_TEXT.android;
    box.hidden = false;
  }
  function installHinweisSchliessen() {
    try {
      const morgen = new Date();
      morgen.setHours(24, 0, 0, 0);
      localStorage.setItem('installHinweisZuBis', String(morgen.getTime()));
    } catch (e) { /* egal */ }
    $('#installHinweis').hidden = true;
  }

  // Eine App, die nur aus dem Hintergrund geholt wird, fragt nie nach einer neuen sw.js –
  // auf dem iPhone oft tagelang, weil iOS die App nur einfriert. Deshalb beim Zurückholen
  // selbst nachsehen, höchstens alle 10 Minuten.
  function pruefeUpdatesBeimZurueckholen(reg) {
    let zuletzt = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - zuletzt < 10 * 60 * 1000) return;
      zuletzt = Date.now();
      reg.update().catch(() => {});
    });
  }

  async function init() {
    // Robust starten: UI bindet sich auch dann, wenn die Daten-Initialisierung
    // (z. B. IndexedDB) auf einem Gerät klemmt – die App darf nie hängenbleiben.
    try {
      setupPhotoInputs();
      bindEvents();
      Vorpruefung.init();
      Behinderung.init();
      Wochenbericht.init();
      updateNetDot();
      initAppVersion();
      $('#installZu').onclick = installHinweisSchliessen;
      pruefeInstallation();
      document.addEventListener('visibilitychange', () => { if (!document.hidden) pruefeInstallation(); });
      window.addEventListener('online', updateNetDot);
      window.addEventListener('offline', updateNetDot);
      show('view-start');
    } catch (e) {
      console.error('Init-Fehler (UI):', e);
    }
    try {
      await ensureCurrentJob();
      await loadStartView();
    } catch (e) {
      console.error('Init-Fehler (Auftragsdaten):', e);
      toast('Hinweis: Gespeicherte Daten konnten nicht geladen werden.');
    }
    // Persistenten Speicher anfordern (schützt Bilder vor automatischer Löschung).
    try {
      if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
    } catch (e) { /* best effort */ }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(pruefeUpdatesBeimZurueckholen)
        .catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
    }
  }

  // ----------------------------------------------------------- Übergabe (xlsx)
  // Macht den übergebenen Auftrag zum aktuellen (nach Übergabe-/ZIP-Import).
  async function adoptJob(job) {
    currentJob = job;
    await DB.setCurrentJobId(job.id);
    resetJobState();
  }

  // Alles, was sich auf den vorherigen Auftrag bezog. Ohne das zeigte das Bautagebuch beim
  // Auftragswechsel weiter das Datum des alten Auftrags, und der Baum behielt dessen
  // aufgeklappte Ordner.
  function resetJobState() {
    catalogNames = null;   // Vorlagen-Dropdown für diesen Auftrag neu aufbauen
    diaryDate = null;
    diaryDatumAutomatisch = true;
    diaryNachtschicht = false;
    nachtAntwort = null;
    diaryEinsatz = 1;
    currentNode = null;
    expandedObers.clear();
    expandedUnters.clear();
    treeStand = new Map();
    Wochenbericht.reset(); // geöffneten Wochenbericht nicht in den neuen Auftrag tragen
    weitereOffen = false;  // Klappfeld „Weitere Aufträge" nach dem Wechsel wieder zu
  }

  // Gemeinsamer Einstieg für BEIDE Import-Knöpfe. Erkannt wird am Inhalt, nicht an der
  // Endung: die Dateiauswahl auf Android hält sich nicht zuverlässig an „accept", und wer
  // die Bilddoku-ZIP über „Übergabe import" wählt, soll nicht auf einer Fehlermeldung
  // sitzenbleiben. Eine .xlsx ist selbst ein ZIP – unterschieden wird an xl/workbook.xml.
  // Dateiart am Inhalt erkennen (nicht an der Endung – Android-Picker und WhatsApp melden
  // Endung/Typ unzuverlässig). Liefert { art: 'xlsx' | 'zip' | null, zip }.
  async function dateiArt(file) {
    let zip = null, art = null, fehler = null;
    try {
      // Direkt aus dem File lesen: ein zusätzliches arrayBuffer() hielte die komplette
      // ZIP (auf der Baustelle schnell einige hundert MB) ein zweites Mal im Speicher.
      zip = await JSZip.loadAsync(file);
      // Wurde die ZIP unterwegs neu gepackt, liegt ihr Inhalt in einem Unterordner –
      // Merge.zipInhalt findet das echte Wurzelverzeichnis (dieselbe Logik wie beim Import).
      const inhalt = Merge.zipInhalt(zip).inhalt;
      if (zip.file('xl/workbook.xml')) art = 'xlsx';
      else if (inhalt.file('manifest.json') || inhalt.file('uebersicht.csv')
        || inhalt.filter((rel, f) => !f.dir && /^[^/]+\.xlsx$/i.test(rel)).length) art = 'zip';
    } catch (err) {
      console.warn('Datei ist weder .xlsx noch .zip:', err);
      // Beginnt die Datei gar nicht mit „PK“, ist sie keine ZIP (falsche Datei gewählt) –
      // nur sonst ist sie beschädigt bzw. unvollständig übertragen.
      let pk = false;
      try { const k = new Uint8Array(await file.slice(0, 2).arrayBuffer()); pk = k[0] === 0x50 && k[1] === 0x4b; } catch (e) { /* egal */ }
      if (pk) fehler = err;
    }
    return { art, zip, fehler };
  }

  // ---------------------------------------------------- Fehlerbericht (ab v83)
  // Beim Import lässt sich aus der Ferne sonst nicht klären, was schiefging („die ZIP geht
  // nicht"). Der Dialog nennt Ursache und Tipp in Klartext; der Knopf schickt einen fertigen
  // Text (Version, Gerät, Datei, Fehler, Speicher) per Teilen-Menü – sonst in die Zwischenablage.
  function geraetKurz() {
    const ua = navigator.userAgent || '';
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iPhone/iPad' + ((ua.match(/OS (\d+)_/) || [])[1] ? ' iOS ' + ua.match(/OS (\d+)_/)[1] : '')
      : /Android/.test(ua) ? 'Android' + ((ua.match(/Android ([\d.]+)/) || [])[1] ? ' ' + ua.match(/Android ([\d.]+)/)[1] : '')
        : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : 'unbekannt';
    const br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Edg\//.test(ua) ? 'Edge'
      : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser?';
    const app = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ? 'als App' : 'im Browser';
    return `${os} · ${br} · ${app}`;
  }
  const groesse = (b) => (b == null ? '?' : b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB'
    : b >= 1e8 ? Math.round(b / 1e6) + ' MB' : b >= 1e6 ? (b / 1e6).toFixed(1).replace('.', ',') + ' MB'
      : b >= 1e3 ? Math.round(b / 1e3) + ' kB' : b + ' Byte');

  // Ursache in Klartext. schritt: 'lesen' | 'zip' | 'xlsx'
  function fehlerUrsache(schritt, err, file) {
    const name = err && err.name;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return fehlerText(err);
    if (file && file.size === 0) return 'Die Datei ist leer (0 Byte). Bitte erneut herunterladen oder neu schicken lassen.';
    if (schritt === 'lesen' && err) {
      return 'Die Datei ist beschädigt oder nicht vollständig heruntergeladen. Bitte in WhatsApp bzw. '
        + 'der Mail erneut herunterladen (warten, bis der Download fertig ist) und nochmals wählen.';
    }
    if (schritt === 'lesen') {
      return 'Das ist keine Bilddoku-ZIP und keine Übergabe-Datei (.xlsx). Tipp iPhone: Die Dateien-App '
        + 'entpackt eine ZIP beim Antippen – dann bitte die ZIP-Datei selbst wählen, nicht den Ordner.';
    }
    return (schritt === 'xlsx' ? 'Die Übergabe-Datei' : 'Die ZIP') + ' konnte nicht eingelesen werden: '
      + ((err && err.message) || String(err || 'unbekannter Fehler'));
  }

  async function importFehler(schritt, err, file) {
    if (err) console.error(err);
    toastWeg();   // „Lese Datei…“ läge sonst über dem Dialog
    const ursache = fehlerUrsache(schritt, err, file);
    const sp = await speicherStand();
    const h = (currentJob && currentJob.header) || {};
    const bericht = [
      'NFK Bilddoku – Fehlerbericht',
      'App-Version: ' + APP_VERSION,
      'Zeit: ' + new Date().toLocaleString('de-DE'),
      'Gerät: ' + geraetKurz(),
      'Datei: ' + (file ? `${file.name || '?'} (${groesse(file.size)}, Typ: ${file.type || 'unbekannt'})` : '–'),
      'Schritt: ' + ({ lesen: 'Datei lesen', zip: 'ZIP zusammenführen', xlsx: 'Übergabe-Datei einlesen' }[schritt] || schritt),
      'Fehler: ' + (err ? `${err.name || 'Error'}: ${err.message || err}` : 'Dateiart nicht erkannt'),
      'Meldung: ' + ursache,
      'Speicher: ' + (sp ? speicherZeile(sp) : 'unbekannt'),
      'Auftrag: ' + (h.filiale || (currentJob && currentJob.name) || '–'),
    ].join('\n');
    openInfoModal('Import nicht möglich',
      `<p>${escHtml(ursache)}</p>
       <p class="hint">Hilft das nicht weiter, schick den Fehlerbericht an Michael – dann ist klar, was passiert ist.</p>
       <button type="button" class="btn" id="fehlerSendenBtn">${Icon('share-2')} Fehlerbericht senden</button>
       <pre class="fehler-bericht">${escHtml(bericht)}</pre>`);
    $('#fehlerSendenBtn').onclick = () => fehlerberichtSenden(bericht);
  }

  async function fehlerberichtSenden(text) {
    if (navigator.share) {
      try { await navigator.share({ title: 'NFK Bilddoku – Fehlerbericht', text }); return; } catch (e) {
        if (e && e.name === 'AbortError') return;   // selbst abgebrochen
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Fehlerbericht kopiert – in WhatsApp einfügen und senden.', 4200);
    } catch (e) {
      toast('Bitte den Text im Fenster markieren und kopieren.', 4200);
    }
  }

  async function importAnyFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    toast('Lese Datei…');
    const { art, zip, fehler } = await dateiArt(file);
    if (art === 'xlsx') return handoverImport(file);
    if (art === 'zip') return mergeContribution(zip, file.name, file);
    await importFehler('lesen', fehler, file);
  }

  // 'v82.4' -> [82, 4]; vergleicht zwei Versionen zahlenweise (<0: a älter als b).
  function versionVergleich(a, b) {
    const zahlen = (v) => String(v || '').replace(/^\D*/, '').split('.').map((n) => parseInt(n, 10) || 0);
    const x = zahlen(a), y = zahlen(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d;
    }
    return 0;
  }

  // Warnt, wenn das Paket mit einer anderen App-Version erstellt wurde (ab v83 steht sie im
  // Paket; fehlt sie, stammt es aus einer älteren Version). Liefert false = Import abbrechen.
  async function versionOk(paketVersion) {
    if (paketVersion && versionVergleich(paketVersion, APP_VERSION) === 0) return true;
    let zeile, rat;
    if (!paketVersion) {
      zeile = `Paket: ältere Version (vor v83) · Deine App: <b>${escHtml(APP_VERSION)}</b>`;
      rat = 'Der Kollege, von dem das Paket stammt, sollte seine App aktualisieren.';
    } else if (versionVergleich(paketVersion, APP_VERSION) < 0) {
      zeile = `Paket: <b>${escHtml(paketVersion)}</b> · Deine App: <b>${escHtml(APP_VERSION)}</b>`;
      rat = 'Der Kollege, von dem das Paket stammt, sollte seine App aktualisieren.';
    } else {
      zeile = `Paket: <b>${escHtml(paketVersion)}</b> · Deine App: <b>${escHtml(APP_VERSION)}</b>`;
      rat = 'Bitte aktualisiere deine App: kurz online gehen, App schließen und neu öffnen.';
    }
    return openConfirm('Andere App-Version',
      `<p>Dieses Paket wurde mit einer anderen App-Version erstellt.</p><p>${zeile}</p>`
      + `<p>${rat} Alle im Team – auch die Helfer – sollten mit demselben Stand arbeiten.</p>`,
      'Trotzdem importieren', false, 'Abbrechen');
  }

  // Wird von Merge/Handover aufgerufen, sobald der Kopf des Pakets gelesen ist und bevor
  // etwas geschrieben wird. Liefert null (= Import abbrechen) oder die Stammdaten-Felder,
  // die aus dem Paket übernommen werden sollen, plus das Ziel bei fremder Filiale:
  //   ziel 'aktuell'  in den offenen Auftrag (Standard)
  //   ziel 'neu'      neuen Auftrag aus dem Paket anlegen (nur ZIP; die .xlsx tut das ohnehin)
  //   ziel 'wechseln' in den vorhandenen Auftrag dieser Filiale (zielJob) wechseln
  async function pruefeHerkunft(paket, ziel, info) {
    // 0) Gleicher Softwarestand? Michael will, dass alle (auch Helfer) mit derselben Version
    //    arbeiten – jede Abweichung wird gemeldet, importieren bleibt aber möglich.
    if (!await versionOk(paket.appVersion)) return null;
    const neuerAuftrag = !!(info && info.neu);
    let eigen = (ziel && ziel.header) || null;
    if (!eigen) return { kopfFelder: [] };   // nichts zu vergleichen
    let antwort = { kopfFelder: [], ziel: 'aktuell' };

    // 1) Gehört das Paket zu dieser Baustelle? Maßgeblich sind allein die vier Ziffern –
    //    die Schreibweise drumherum („LI7423", „DE7423", „7423 München") wird frei getippt.
    const nrEigen = filialNr(eigen.filiale), nrPaket = paket.filialNr;
    let nummerWeicthAb = !!(nrEigen && nrPaket && nrEigen !== nrPaket);
    if (nummerWeicthAb) {
      // Die Bezeichnung des Pakets nur zeigen, wenn es eine gibt: bei alten ZIPs ohne
      // Kopfdaten stammt die Nummer aus den Bild-Dateinamen, ein Klartext fehlt dann.
      const paketZeile = paket.filiale
        ? `Paket: „${escHtml(paket.filiale)}"`
        : 'Im Paket steht nur die Nummer (aus den Bilddateien gelesen).';
      // Gibt es die Baustelle hier schon, dorthin wechseln statt einen zweiten Auftrag
      // derselben Filiale anzulegen – sonst fotografiert man womöglich in den falschen.
      // Auch für die Übergabe-Datei: die findet ihren Auftrag sonst nur über die
      // Auftrags-id und legt einen zweiten an, wenn die Baustelle hier von Hand entstand.
      const zipImport = !(info && info.xlsx);
      const vorhanden = (await DB.listJobs())
        .find((j) => j.id !== ziel.id && filialNr((j.header || {}).filiale) === nrPaket) || null;
      const optionen = [];
      if (vorhanden) {
        optionen.push({ key: 'wechseln', icon: 'arrow-left-right',
          titel: `Zu Auftrag „${vorhanden.name || vorhanden.header.filiale}" wechseln`,
          sub: (zipImport ? 'Paket dort einlesen – Bilder und Stand kommen dazu' : 'Stand dort einlesen – Zähler kommen dazu')
            + ', nichts wird überschrieben. Dieser Auftrag bleibt unverändert.' });
      } else if (neuerAuftrag || paket.hatUebergabe) {
        optionen.push({ key: 'neu', icon: 'circle-plus',
          titel: `Neuen Auftrag für Filiale ${nrPaket} anlegen`,
          sub: (zipImport ? 'Stammdaten, Bilder und Stand' : 'Stammdaten und Stand')
            + ' werden übernommen – Vorprüfung entfällt. Dieser Auftrag bleibt unverändert.' });
      }
      if (!neuerAuftrag) {
        optionen.push({ key: 'aktuell', icon: 'triangle-alert', cls: 'danger',
          titel: 'Trotzdem in diesen Auftrag importieren',
          sub: zipImport
            ? `Fremde Bilder landen in der Dokumentation von ${nrEigen}`
            : `Stammdaten und Stand von ${nrEigen} werden überschrieben` });
      }
      const ohneNeu = zipImport && !vorhanden && !paket.hatUebergabe
        ? '<p class="hint">Das Paket enthält keine Übergabe-Daten – daraus lässt sich kein neuer Auftrag anlegen.</p>'
        : '';
      const wahl = await openAuswahl('Andere Filiale!',
        `<p>Dieses Paket gehört zu Filiale <b>${escHtml(nrPaket)}</b>,
            dieser Auftrag ist Filiale <b>${escHtml(nrEigen)}</b>.</p>
         <p>Dein Auftrag: „${escHtml(eigen.filiale || '')}"<br>${paketZeile}</p>${ohneNeu}`,
        optionen);
      if (!wahl) return null;
      if (wahl === 'neu') return { kopfFelder: [], ziel: 'neu' };
      if (wahl === 'wechseln') {
        // Die Übergabe-Datei liest weich in den vorhandenen Auftrag ein und lässt dessen
        // Projektkopf ohnehin unangetastet – dann ist auch nichts gegenüberzustellen.
        if (!zipImport) return { kopfFelder: [], ziel: 'wechseln', zielJob: vorhanden };
        // Ab hier gilt der vorhandene Auftrag als Ziel – Stammdaten gegen DEN vergleichen.
        antwort = { kopfFelder: [], ziel: 'wechseln', zielJob: vorhanden };
        eigen = vorhanden.header || {};
        nummerWeicthAb = false;
      }
    }
    // Bei einem neuen Auftrag kommen die Stammdaten ohnehin vollständig mit – nichts zu wählen.
    if (neuerAuftrag) return antwort;

    // 2) Gleiche Filiale, aber abweichend geschriebene Stammdaten: gegenüberstellen und
    //    Feld für Feld entscheiden lassen. Ist das eigene Feld leer, ist das Paket vorgewählt.
    const felder = [];
    for (const [name, label] of [['filiale', 'Bauvorhaben / Filiale'], ['ort', 'Ort']]) {
      const meins = String(eigen[name] || '').trim();
      const ihres = String(paket[name] || '').trim();
      if (ihres && meins !== ihres) {
        felder.push({ name, label, eigen: meins, paket: ihres, vorauswahl: meins ? 'eigen' : 'paket' });
      }
    }
    if (!felder.length) return antwort;

    const alleLeer = felder.every((f) => !f.eigen);
    const einleitung = (nummerWeicthAb
      ? 'Die Angaben im Paket lauten anders als in deinem Auftrag.'
      : alleLeer
        ? 'Dein Auftrag hat dazu noch keine Angaben.'
        : 'Gleiche Filiale, aber unterschiedlich geschriebene Angaben.')
      + ' Wähle je Zeile, was in deinem Auftrag stehen soll.';
    const wahl = await openChoiceModal('Stammdaten weichen ab',
      '<p class="hint">' + einleitung + '</p>',
      felder, { ok: 'Übernehmen', cancel: 'Meine behalten' });
    antwort.kopfFelder = wahl ? Object.keys(wahl).filter((k) => wahl[k] === 'paket') : [];
    return antwort;
  }

  async function mergeContribution(zip, dateiname, file) {
    toast('Führe Bilder zusammen…');
    try {
      // Offene Eingaben gehören noch zum bisherigen Auftrag – der Import kann gleich wechseln.
      await flushDiary();
      await Vorpruefung.flush();
      await Wochenbericht.flush();
      const r = await Merge.importContributionZip(zip, { dateiname, pruefen: pruefeHerkunft });
      if (r.abgebrochen) { toast('Import abgebrochen – nichts verändert.'); return; }
      if ((r.jobNeu || r.gewechselt) && aktiveView === 'view-bilddoku') await enterBilddoku();
      await renderTree();
      await renderBackupReminder('#backupReminder');
      if (r.jobNeu || r.strukturUebernommen) {
        populateTemplateSelect(await Structure.getSelectedTemplate());
      }
      const teile = [];
      if (r.jobNeu) teile.push('Neuer Auftrag „' + (currentJob.name || '') + '" angelegt');
      else if (r.gewechselt) teile.push('Gewechselt zu „' + (currentJob.name || '') + '"');
      else if (r.strukturUebernommen) teile.push('Struktur übernommen');
      teile.push(`${r.added} Bild(er) übernommen`);
      if (r.skipped) teile.push(`${r.skipped} bereits vorhanden`);
      if (r.addedNodes && r.addedNodes.length) teile.push(`${r.addedNodes.length} neue Position(en)`);
      if (r.unbekannt && !r.strukturUebernommen) teile.push(`${r.unbekannt} fremde Position(en)`);
      // Fehlende Dateien MÜSSEN sichtbar sein: sonst hält der Techniker eine unvollständig
      // übertragene ZIP für vollständig eingelesen.
      if (r.missing) teile.push(`⚠ ${r.missing} Bild(er) fehlten im Archiv`);
      if (r.kopfFelder && r.kopfFelder.length) teile.push('Stammdaten aktualisiert');
      // Immer: Projektformular, Auftragsliste und Sperre auf den neuen Stand bringen – der
      // Import kann auch von der Startseite aus einen leeren Auftrag befüllt haben.
      await loadStartView();
      toast(teile.join(' · '), 4200);
    } catch (err) {
      await importFehler('zip', err, file);
    }
  }

  // Nach einer Übernahme den leeren Auftrag entfernen, der vorher offen war: das automatisch
  // angelegte „Auftrag 1" oder ein frisch angelegter, in den jemand nur Stammdaten getippt
  // hat. Nur, wenn wirklich nichts drinsteckt – und nur, wenn er zur selben Filiale gehört
  // oder noch keine Filiale gespeichert hat. Sonst stünden zwei Aufträge derselben Baustelle
  // in der Liste, und der Techniker fotografiert womöglich in den falschen.
  async function entferneLeerenVorlaeufer(vorher, neuer) {
    if (!vorher || !neuer || vorher.id === neuer.id) return false;
    try {
      const alt = await DB.getJob(vorher.id);
      if (!alt) return false;
      if ((alt.behinderungen || []).length) return false;
      if ((alt.customNames || []).length) return false;   // eigene Namen sind Inhalt
      if ((await DB.getAllPhotos(alt.id)).length) return false;
      if ((await DB.listDiary(alt.id)).length) return false;
      const filialeAlt = String((alt.header || {}).filiale || '').trim();
      const nrAlt = filialNr(filialeAlt), nrNeu = filialNr((neuer.header || {}).filiale);
      if (nrAlt && nrNeu && nrAlt !== nrNeu) return false;   // andere Baustelle – stehenlassen
      if (!nrAlt && filialeAlt) return false;                // Nummer unklar – nicht anfassen
      await DB.deleteJob(alt.id);
      return true;
    } catch (e) {
      console.warn('Leeren Vorgänger-Auftrag nicht entfernt:', e);
      return false;
    }
  }

  async function handoverImport(file) {
    toast('Lese Übergabe-Datei…');
    const vorher = currentJob;
    try {
      // Offene Eingaben gehören noch zum bisherigen Auftrag – der Import wechselt gleich.
      await flushDiary();
      await Vorpruefung.flush();
      await Wochenbericht.flush();
      const r = await Handover.importXlsx(file, { pruefen: pruefeHerkunft });
      if (!r) { toast('Import abgebrochen – nichts verändert.'); return; }
      const job = r.job;
      await adoptJob(job);
      const entfernt = await entferneLeerenVorlaeufer(vorher, job);
      // Dort bleiben, wo der Import gestartet wurde: Wer aus der Bilddoku heraus importiert,
      // will den neuen Baum sehen und nicht unvermittelt im Hauptmenü stehen.
      if (aktiveView === 'view-bilddoku') await enterBilddoku();
      else show('view-start');
      await loadStartView();
      toast((r.gewechselt ? 'Stand übernommen in: ' : 'Auftrag übernommen: ') + (job.name || '')
        + (entfernt ? ' · leerer Auftrag entfernt' : ''), 4200);
    } catch (err) {
      await importFehler('xlsx', err, file);
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Öffentlich für andere Module:
  return { APP_VERSION, sanft, busy, animOpen, animClose, dreheChev, halteKopf, kopfNachOben, pop, toast, openInfoModal, openFormModal, openConfirm, shareFile, show, getCurrentJob, saveCurrentJob, adoptJob, filialNr, fehlerText };
})();
