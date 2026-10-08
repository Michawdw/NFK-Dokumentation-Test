/* wochenbericht.js – Wochenabfrage Baustelle für den Innendienst.
   Am Ende jeder Arbeitswoche hält der Vorarbeiter den Baufortschritt fest: fester
   Fragenkatalog in sieben Abschnitten, Pflichtfotos und Pflicht-Begründungen an
   festgelegten Stellen, dazu ein optionales Notizfeld je Auswahlpunkt. Daraus entsteht
   ein gestalteter Word-Bericht (Logo, Ampel-Übersicht, farbige Abschnitts-Balken, Fotos
   zwei pro Zeile), der über App.shareFile verschickt wird.

   Der Bericht bleibt jederzeit bearbeitbar (kein „Abschließen"). Den Word-Bericht gibt es
   erst, wenn alles vollständig ist – offene Punkte werden dann rot markiert. Je
   Kalenderwoche und Auftrag gibt es genau einen Bericht. Wie die Baubehinderungsanzeigen
   bleiben die Berichte beim Team (keine Übergabe); ihre Fotos stecken aber im ZIP-Export.

   Daten liegen am Job-Objekt (kein DB-Schema-Bump):
     job.wochenberichte = [ { id, kw:'2026-W41', gespraechspartner,
                              antworten: { <pid>: { status, text, notiz, nichts,
                                                    unter: { status, text } } },
                              erstelltAm, updatedAt, exportiertAm } ]
   Fotos liegen im photos-Store unter '__wochenbericht__<id>__<pid>' (Fortschrittsbilder:
   '<pid>' = 'd2-<gruppe>'), Feld kind:'wochenbericht', caption. Das führende '__' hält
   sie aus Bilddoku, Zählern und Sicherungs-Erinnerung heraus (DB.isBilddokuPhoto).
*/
const Wochenbericht = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const NS = '__wochenbericht__';
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ Fragenkatalog
  // Typen:  'wahl'  Auswahlknöpfe (+ optional Pflichttext, Pflichtfotos, Unterfrage)
  //         'frei'  Freitext oder Knopf „– nichts –" (nichts: Beschriftung des Knopfs)
  //         'fotos' freiwillige Fotogruppen, zählt nicht zur Vollständigkeit
  // Ampel je Option (Word-Übersicht): gruen | gelb | rot | grau
  const JA_NEIN = (jaAmpel, neinAmpel) => [
    { v: 'ja', label: 'Ja', ampel: jaAmpel }, { v: 'nein', label: 'Nein', ampel: neinAmpel }];
  const KABELZUG = [
    { v: 'ja', label: 'Ja', ampel: 'gruen' },
    { v: 'teilweise', label: 'teilweise', ampel: 'gelb',
      text: { pflicht: true, label: 'Was ist noch offen? (Pflichtfeld)' } },
    { v: 'nein', label: 'Nein', ampel: 'rot' },
  ];

  const ABSCHNITTE = [
    { id: 's1', titel: 'Behinderungen', punkte: [
      { id: 'b1', typ: 'wahl', titel: 'Bestehende Behinderungen', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'rot',
          fotos: { min: 1, label: 'Foto der Behinderung (Pflicht, mindestens 1)' },
          unter: { titel: 'An Innendienst übermittelt', optionen: [
            { v: 'ja', label: 'Ja', ampel: 'gruen' },
            { v: 'nein', label: 'Nein', ampel: 'rot',
              text: { pflicht: true, label: 'Begründung – warum nicht übermittelt? (Pflichtfeld)' } },
          ] } },
        { v: 'nein', label: 'Nein', ampel: 'gruen' },
      ] },
    ] },
    { id: 's2', titel: 'Baufortschritt allgemein', punkte: [
      { id: 'a1', typ: 'frei', titel: 'Diese Woche abgeschlossen', nichts: '– nichts –', ausBautagebuch: true },
      { id: 'a2', typ: 'frei', titel: 'Noch offen', nichts: '– nichts –' },
      { id: 'a3', typ: 'wahl', titel: 'Fertigstellungstermin gefährdet', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'rot', text: { pflicht: true, label: 'Begründung (Pflichtfeld)' } },
        { v: 'nein', label: 'Nein', ampel: 'gruen' },
      ] },
    ] },
    { id: 's3', titel: 'Fortschritt nach Bereichen', punkte: [
      { id: 'f1', typ: 'wahl', titel: 'Kabelzug Datenkabel beendet', optionen: KABELZUG },
      { id: 'f2', typ: 'wahl', titel: 'Kabelzug Instore-Communication beendet', optionen: KABELZUG },
      { id: 'f3', typ: 'frei', titel: 'Ausbau Datendosen, abgeschlossene Bereiche', nichts: '– noch keine –' },
      { id: 'f4', typ: 'wahl', titel: 'Messung Datenports', optionen: [
        { v: 'keine', label: 'keine', ampel: 'grau' },
        { v: 'teilweise', label: 'teilweise', ampel: 'gelb' },
        { v: 'komplett', label: 'komplett', ampel: 'gruen' },
      ] },
      { id: 'f5', typ: 'wahl', titel: 'NWS eingebracht', viele: true, optionen: [
        { v: 'nichtangeliefert', label: 'noch nicht angeliefert', ampel: 'grau' },
        { v: 'angeliefert', label: 'angeliefert, nicht eingebracht', ampel: 'gelb',
          fotos: { min: 1, label: 'Foto der Netzwerkschränke (Pflicht, mindestens 1)' } },
        { v: 'filiale', label: 'in der Filiale', ampel: 'gelb',
          fotos: { min: 1, label: 'Foto der Netzwerkschränke (Pflicht, mindestens 1)' } },
        { v: 'serverraum', label: 'im Serverraum aufgestellt', ampel: 'gruen',
          fotos: { min: 1, label: 'Foto der Netzwerkschränke (Pflicht, mindestens 1)' } },
      ] },
      { id: 'f6', typ: 'frei', titel: 'Aufbau Serverschränke (Fortschritt)', nichts: '– noch nicht begonnen –' },
      { id: 'f7', typ: 'frei', titel: 'Inbetriebnahme (Fortschritt)', nichts: '– noch nicht begonnen –' },
      { id: 'f8', typ: 'wahl', titel: 'Aufbau Büro abgeschlossen', optionen: JA_NEIN('gruen', 'gelb') },
      { id: 'f9', typ: 'wahl', titel: 'Aufbau LiLi abgeschlossen', optionen: JA_NEIN('gruen', 'gelb') },
      { id: 'f10', typ: 'wahl', titel: 'Digitales Backschema aufgebaut', optionen: JA_NEIN('gruen', 'gelb') },
      { id: 'f11', typ: 'wahl', titel: 'Headset installiert', optionen: JA_NEIN('gruen', 'gelb') },
    ] },
    { id: 's4', titel: 'Dokumentation', punkte: [
      { id: 'd1', typ: 'wahl', titel: 'Bilddokumentation', optionen: [
        { v: 'keine', label: 'keine', ampel: 'rot' },
        { v: 'teilweise', label: 'teilweise', ampel: 'gelb' },
        { v: 'komplett', label: 'komplett', ampel: 'gruen' },
      ] },
      { id: 'd2', typ: 'fotos', titel: 'Fortschrittsbilder (freiwillig, nur zur Übersicht)', gruppen: [
        { id: 'server', label: 'Serverschränke' }, { id: 'kabel', label: 'Kabelzüge' },
      ] },
      { id: 'd3', typ: 'wahl', titel: 'VoCoVo-Ausleuchtung übermittelt (nur zu Beginn der Baustelle)', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'gruen' },
        { v: 'nein', label: 'Nein', ampel: 'gelb' },
        { v: 'erledigt', label: 'bereits erledigt', ampel: 'gruen' },
      ] },
    ] },
    { id: 's5', titel: 'Rückfragen & Vorkommnisse', punkte: [
      { id: 'r1', typ: 'frei', titel: 'Offene Rückfragen an Innendienst / FlexPos', nichts: '– keine –' },
      { id: 'r2', typ: 'frei', titel: 'Besondere Vorkommnisse (Schäden, Mängel, Konflikte in der Filiale)',
        nichts: '– keine –', fotosFrei: 'Fotos (freiwillig)' },
      { id: 'r3', typ: 'frei', titel: 'Sonstiges', nichts: '– nichts –' },
    ] },
    { id: 's6', titel: 'Material', punkte: [
      { id: 'm1', typ: 'wahl', titel: 'SDP-Anlieferung vollständig', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'gruen' },
        { v: 'nein', label: 'Nein', ampel: 'rot',
          text: { pflicht: true, label: 'Was fehlt? (Pflichtfeld)' },
          unter: { titel: 'An FlexPos gemeldet', optionen: [
            { v: 'ja', label: 'Ja', ampel: 'gelb' }, { v: 'nein', label: 'Nein', ampel: 'rot' },
          ] } },
      ] },
      { id: 'm2', typ: 'wahl', titel: 'Material in Filiale hinterlassen', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'gelb',
          text: { pflicht: true, label: 'Lagerort (Pflichtfeld)' },
          fotos: { min: 1, label: 'Foto des Lagerorts (Pflicht, mindestens 1)' } },
        { v: 'nein', label: 'Nein', ampel: 'gruen' },
      ] },
    ] },
    { id: 's7', titel: 'Tickets', punkte: [
      { id: 't1', typ: 'wahl', titel: 'Alle zugewiesenen Tickets an- und abgemeldet', optionen: [
        { v: 'ja', label: 'Ja', ampel: 'gruen' },
        { v: 'nein', label: 'Nein', ampel: 'rot', text: { pflicht: true, label: 'Begründung (Pflichtfeld)' } },
      ] },
    ] },
  ];
  const ALLE_PUNKTE = ABSCHNITTE.flatMap((s) => s.punkte);
  const PFLICHT_PUNKTE = ALLE_PUNKTE.filter((p) => p.typ !== 'fotos');
  const D2_GRUPPEN = new Set(ALLE_PUNKTE.filter((p) => p.gruppen).flatMap((p) => p.gruppen.map((g) => p.id + '-' + g.id)));

  // --------------------------------------------------------- Kalenderwochen
  // ISO 8601: Woche mit dem ersten Donnerstag des Jahres ist KW 1, Wochen beginnen montags.
  function isoWoche(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const tag = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - tag);
    const jahr = t.getUTCFullYear();
    const woche = Math.ceil(((t - Date.UTC(jahr, 0, 1)) / 86400000 + 1) / 7);
    return { jahr, woche };
  }
  const kwKey = (o) => o.jahr + '-W' + String(o.woche).padStart(2, '0');
  function kwParse(key) {
    const m = String(key || '').match(/^(\d{4})-W(\d{2})$/);
    return m ? { jahr: +m[1], woche: +m[2] } : null;
  }
  // Montag der ISO-Woche als lokales Datum.
  function montag(o) {
    const jan4 = new Date(o.jahr, 0, 4);
    const tag = jan4.getDay() || 7;
    const m = new Date(o.jahr, 0, 4 - tag + 1);
    m.setDate(m.getDate() + (o.woche - 1) * 7);
    return m;
  }
  const plusTage = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const kurz = (d) => String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.';
  function kwText(key) {
    const o = kwParse(key);
    return o ? `KW ${o.woche}/${o.jahr}` : String(key || '');
  }
  function zeitraumText(key) {
    const o = kwParse(key);
    if (!o) return '';
    const mo = montag(o);
    return kurz(mo) + '–' + kurz(plusTage(mo, 4)) + o.jahr;
  }

  // KW-Auswahl: von der KW des Auftragsdatums bis heute, dazu alle KWs mit Bericht.
  function kwListe(job) {
    const heute = kwKey(isoWoche(new Date()));
    const set = new Set([heute]);
    const datum = job && job.header && job.header.datum;
    const m = String(datum || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      let d = new Date(+m[1], +m[2] - 1, +m[3]);
      for (let i = 0; i < 60 && d <= new Date(); i++, d = plusTage(d, 7)) set.add(kwKey(isoWoche(d)));
    }
    for (const b of liste(job)) set.add(b.kw);
    return Array.from(set).sort().reverse();
  }

  // ------------------------------------------------------------------ Zustand
  let current = null;         // geöffneter Bericht (evtl. noch nicht im Job gespeichert)
  let fotoZahl = new Map();   // pid -> Anzahl Fotos im geöffneten Bericht
  let offen = new Set();      // aufgeklappte Abschnitte
  let activeUrls = [];
  let cameraInput = null, galleryInput = null, fotoZiel = null;
  let saveTimer = null;
  // Nach einem Export-Versuch mit offenen Punkten bleiben diese rot markiert, bis sie
  // erledigt sind – auch über spätere Neuaufbauten der Liste hinweg.
  let pruefModus = false;

  const liste = (job) => (job && job.wochenberichte) || [];
  const nodeKeyFor = (id, pid) => NS + id + '__' + pid;
  const neueId = () => 'wb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function leer(kw) {
    return { id: neueId(), kw, gespraechspartner: '', antworten: {}, erstelltAm: Date.now(), updatedAt: Date.now(), exportiertAm: null };
  }
  function antwort(pid) {
    const a = current.antworten;
    if (!a[pid]) a[pid] = { status: null, text: '', notiz: '', nichts: false, unter: { status: null, text: '' } };
    if (!a[pid].unter) a[pid].unter = { status: null, text: '' };
    return a[pid];
  }
  // Ein neuer Bericht kommt erst mit der ersten Eingabe in den Auftrag – sonst stünde
  // nach jedem Durchblättern der KWs ein leerer Bericht im Archiv.
  function ablegen() {
    const job = App.getCurrentJob();
    if (!job || !current) return;
    if (!job.wochenberichte) job.wochenberichte = [];
    if (!job.wochenberichte.includes(current)) job.wochenberichte.push(current);
    current.updatedAt = Date.now();
  }
  function scheduleSave() {
    ablegen();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { App.saveCurrentJob(); }, 500);
  }
  async function saveNow() {
    ablegen();
    clearTimeout(saveTimer);
    await App.saveCurrentJob();
  }
  // Beim Verlassen der Ansicht, Auftragswechsel und Wegwischen der App (wie Vorpruefung.flush).
  async function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try { await App.saveCurrentJob(); } catch (e) { console.warn('Wochenbericht sichern fehlgeschlagen', e); }
  }

  // ----------------------------------------------------------- Vollständigkeit
  const voll = (s) => !!String(s || '').trim();
  function punktFertig(p) {
    if (p.typ === 'fotos') return true;
    const a = (current && current.antworten[p.id]) || {};
    if (p.typ === 'frei') return !!a.nichts || voll(a.text);
    const opt = p.optionen.find((o) => o.v === a.status);
    if (!opt) return false;
    if (opt.text && opt.text.pflicht && !voll(a.text)) return false;
    if (opt.fotos && (fotoZahl.get(p.id) || 0) < opt.fotos.min) return false;
    if (opt.unter) {
      const u = a.unter || {};
      const uo = opt.unter.optionen.find((o) => o.v === u.status);
      if (!uo) return false;
      if (uo.text && uo.text.pflicht && !voll(u.text)) return false;
    }
    return true;
  }
  const kopfFertig = () => voll(current && current.gespraechspartner);
  function stand() {
    const fertig = PFLICHT_PUNKTE.filter(punktFertig).length + (kopfFertig() ? 1 : 0);
    return { fertig, gesamt: PFLICHT_PUNKTE.length + 1 };
  }
  const abschnittStand = (s) => {
    const pf = s.punkte.filter((p) => p.typ !== 'fotos');
    return { fertig: pf.filter(punktFertig).length, gesamt: pf.length };
  };

  // ------------------------------------------------------------------ Fotos
  function setupInputs() {
    if (cameraInput) return;
    cameraInput = document.createElement('input');
    cameraInput.type = 'file'; cameraInput.accept = 'image/*';
    cameraInput.capture = 'environment'; cameraInput.hidden = true;
    galleryInput = document.createElement('input');
    galleryInput.type = 'file'; galleryInput.accept = 'image/*';
    galleryInput.multiple = true; galleryInput.hidden = true;
    cameraInput.addEventListener('change', onPhotosSelected);
    galleryInput.addEventListener('change', onPhotosSelected);
    document.body.appendChild(cameraInput);
    document.body.appendChild(galleryInput);
  }

  async function onPhotosSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !fotoZiel || !current) return;
    const job = App.getCurrentJob();
    await saveNow();                       // Bericht existiert jetzt sicher im Auftrag
    const nodeKey = nodeKeyFor(current.id, fotoZiel);
    const deviceId = await DB.getDeviceId();
    for (const file of files) {
      try {
        const blob = await Photos.compress(file);
        const n = await DB.countPhotos(job.id, nodeKey);
        await DB.addPhoto({
          jobId: job.id, nodeKey, seq: n + 1, blob, createdAt: Date.now(), caption: '', kind: 'wochenbericht',
          srcId: deviceId + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        });
      } catch (err) {
        console.error(err);
        App.toast('Foto konnte nicht hinzugefügt werden: ' + App.fehlerText(err), 5000);
      }
    }
    await zaehleFotos();
    await render(`.wb-item[data-pid="${fotoZiel.split('-')[0]}"]`);
  }

  async function fotosVon(pid) {
    const job = App.getCurrentJob();
    if (!job || !current) return [];
    return DB.getPhotos(job.id, nodeKeyFor(current.id, pid));
  }
  async function zaehleFotos() {
    fotoZahl = new Map();
    const job = App.getCurrentJob();
    if (!job || !current) return;
    const praefix = NS + current.id + '__';
    for (const p of await DB.getAllPhotos(job.id)) {
      if (typeof p.nodeKey !== 'string' || p.nodeKey.indexOf(praefix) !== 0) continue;
      const teil = p.nodeKey.slice(praefix.length);
      const pid = teil.split('-')[0];
      // Fotos aus nicht mehr angebotenen Fortschritts-Gruppen (NWS, Inbetriebnahme bis
      // v50) zählen nicht mehr mit – sie bleiben gespeichert und stecken weiter im ZIP.
      if (teil.includes('-') && !D2_GRUPPEN.has(teil)) continue;
      fotoZahl.set(pid, (fotoZahl.get(pid) || 0) + 1);
    }
  }

  async function fotoBlock(cont, pid, label, pflichtMin) {
    const box = document.createElement('div');
    box.className = 'wb-fotos';
    const anzahl = (await fotosVon(pid)).length;
    const fehlt = pflichtMin && anzahl < pflichtMin;
    box.innerHTML = `<div class="wb-fotolabel${fehlt ? ' fehlt' : ''}">${escHtml(label)}</div>
      <div class="vp-photos"></div>
      <div class="toolrow vp-photobtns">
        <button type="button" class="btn ghost wb-cam">📷 Foto</button>
        <button type="button" class="btn ghost wb-gal">🖼 Galerie</button>
      </div>`;
    box.querySelector('.wb-cam').onclick = () => { fotoZiel = pid; cameraInput.click(); };
    box.querySelector('.wb-gal').onclick = () => { fotoZiel = pid; galleryInput.click(); };
    cont.appendChild(box);
    const thumbs = box.querySelector('.vp-photos');
    for (const ph of await fotosVon(pid)) {
      const url = URL.createObjectURL(ph.blob);
      activeUrls.push(url);
      const w = document.createElement('div');
      w.className = 'vp-thumb';
      w.innerHTML = `<img src="${url}" alt="" loading="lazy" />
        <input class="vp-cap" type="text" placeholder="Bildunterschrift" value="${escAttr(ph.caption || '')}" autocomplete="off" />
        <button type="button" class="vp-del" title="Foto entfernen">✕</button>`;
      w.querySelector('.vp-cap').onchange = async (ev) => { ph.caption = ev.target.value; await DB.updatePhoto(ph); };
      w.querySelector('.vp-del').onclick = async () => {
        const ok = await App.openConfirm('Foto entfernen?', '<p>Dieses Foto wirklich aus dem Wochenbericht entfernen?</p>', 'Entfernen', true);
        if (!ok) return;
        await DB.deletePhotoById(ph.id);
        await zaehleFotos();
        await render(`.wb-item[data-pid="${pid.split('-')[0]}"]`);
      };
      thumbs.appendChild(w);
    }
  }

  // --------------------------------------------------------------- Rendering
  function auswahlKnoepfe(optionen, aktiv, viele) {
    const art = (o) => (o.ampel === 'gruen' ? 'ok' : o.ampel === 'rot' ? 'warn' : o.ampel === 'gelb' ? 'mid' : 'neutral');
    return `<div class="vp-seg wb-seg${viele ? ' viele' : ''}" role="group">` + optionen.map((o) =>
      `<button type="button" class="vp-opt${aktiv === o.v ? ' active ' + art(o) : ''}" data-val="${escAttr(o.v)}">${escHtml(o.label)}</button>`
    ).join('') + '</div>';
  }

  // Textfeld so hoch wie sein Inhalt (mindestens die CSS-Mindesthöhe). Ohne Zieh-Griff:
  // der ließ sich beim Scrollen versehentlich greifen und das Feld auf eine Zeile stauchen.
  function autoHoehe(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 2 + 'px';
  }

  async function karte(p) {
    const a = antwort(p.id);
    const card = document.createElement('div');
    card.className = 'wb-item' + (p.typ === 'fotos' ? ' neutral' : '');
    card.dataset.pid = p.id;
    card.innerHTML = `<div class="wb-q"><span class="wb-check">✓</span>${escHtml(p.titel)}</div>`;

    if (p.typ === 'wahl') {
      const opt = p.optionen.find((o) => o.v === a.status);
      card.insertAdjacentHTML('beforeend', auswahlKnoepfe(p.optionen, a.status, p.viele));
      card.querySelectorAll('.wb-seg > .vp-opt').forEach((b) => {
        b.onclick = async () => { a.status = b.dataset.val; await saveNow(); await render(`.wb-item[data-pid="${p.id}"]`); };
      });
      if (opt && opt.text) {
        card.insertAdjacentHTML('beforeend', `<label class="vp-textlabel wb-detail">${escHtml(opt.text.label)}
          <textarea class="vp-text wb-auto wb-text" rows="3">${escHtml(a.text || '')}</textarea></label>`);
        card.querySelector('.wb-text').oninput = (ev) => { a.text = ev.target.value; autoHoehe(ev.target); scheduleSave(); aktualisiere(); };
      }
      if (opt && opt.unter) {
        const u = a.unter;
        const uo = opt.unter.optionen.find((o) => o.v === u.status);
        const box = document.createElement('div');
        box.className = 'wb-unter';
        box.innerHTML = `<div class="wb-uq">${escHtml(opt.unter.titel)}</div>${auswahlKnoepfe(opt.unter.optionen, u.status)}`
          + (uo && uo.text ? `<label class="vp-textlabel wb-detail">${escHtml(uo.text.label)}
              <textarea class="vp-text wb-auto wb-utext" rows="3">${escHtml(u.text || '')}</textarea></label>` : '');
        box.querySelectorAll('.vp-opt').forEach((b) => {
          b.onclick = async () => { u.status = b.dataset.val; await saveNow(); await render(`.wb-item[data-pid="${p.id}"]`); };
        });
        const ut = box.querySelector('.wb-utext');
        if (ut) ut.oninput = (ev) => { u.text = ev.target.value; autoHoehe(ev.target); scheduleSave(); aktualisiere(); };
        card.appendChild(box);
      }
      if (opt && opt.fotos) await fotoBlock(card, p.id, opt.fotos.label, opt.fotos.min);

      // Notiz: eingeklappt, offen sobald etwas drinsteht.
      const hatNotiz = voll(a.notiz);
      card.insertAdjacentHTML('beforeend', `<button type="button" class="wb-notizbtn"${hatNotiz ? ' hidden' : ''}>+ Notiz</button>
        <label class="vp-textlabel wb-notiz"${hatNotiz ? '' : ' hidden'}>Notiz (freiwillig)
          <textarea class="vp-text wb-auto wb-notiztext" rows="2">${escHtml(a.notiz || '')}</textarea></label>`);
      const nb = card.querySelector('.wb-notizbtn'), nl = card.querySelector('.wb-notiz');
      nb.onclick = () => { nb.hidden = true; nl.hidden = false; autoHoehe(nl.querySelector('textarea')); nl.querySelector('textarea').focus(); };
      nl.querySelector('textarea').oninput = (ev) => { a.notiz = ev.target.value; autoHoehe(ev.target); scheduleSave(); };
    }

    if (p.typ === 'frei') {
      card.insertAdjacentHTML('beforeend', `<textarea class="vp-text wb-auto wb-frei" rows="3" placeholder="Eintragen …">${escHtml(a.text || '')}</textarea>
        <div class="toolrow wb-freibtns">
          <button type="button" class="btn ghost wb-nichts${a.nichts ? ' active' : ''}">${escHtml(p.nichts)}</button>
          ${p.ausBautagebuch ? '<button type="button" class="btn ghost wb-btb">📋 aus Bautagebuch übernehmen</button>' : ''}
        </div>`);
      const ta = card.querySelector('.wb-frei');
      const nichtsBtn = card.querySelector('.wb-nichts');
      ta.oninput = () => {
        a.text = ta.value;
        autoHoehe(ta);
        if (voll(a.text) && a.nichts) { a.nichts = false; nichtsBtn.classList.remove('active'); }
        scheduleSave(); aktualisiere();
      };
      nichtsBtn.onclick = async () => {
        if (a.nichts) { a.nichts = false; await saveNow(); await render(`.wb-item[data-pid="${p.id}"]`); return; }
        if (voll(a.text)) {
          const ok = await App.openConfirm('Eintrag verwerfen?',
            `<p>„${escHtml(p.nichts)}" ersetzt den eingetragenen Text.</p>`, 'Ersetzen', true);
          if (!ok) return;
        }
        a.text = ''; a.nichts = true;
        await saveNow(); await render(`.wb-item[data-pid="${p.id}"]`);
      };
      const btb = card.querySelector('.wb-btb');
      if (btb) btb.onclick = () => ausBautagebuch(a);
      if (p.fotosFrei) await fotoBlock(card, p.id, p.fotosFrei, 0);
    }

    if (p.typ === 'fotos') {
      card.insertAdjacentHTML('beforeend', '<p class="hint wb-fotohint">Rein informativ für den Innendienst – unabhängig von der Bilddokumentation.</p>');
      for (const g of p.gruppen) await fotoBlock(card, p.id + '-' + g.id, g.label, 0);
    }
    return card;
  }

  // Zustand von Karten, Abschnitten und Zählern nachziehen, ohne die Liste neu zu bauen –
  // sonst verlöre das Textfeld beim Tippen den Fokus.
  function aktualisiere() {
    if (!current) return;
    for (const p of ALLE_PUNKTE) {
      const el = document.querySelector(`.wb-item[data-pid="${p.id}"]`);
      if (!el || p.typ === 'fotos') continue;
      const ok = punktFertig(p);
      el.classList.toggle('done', ok);
      el.classList.toggle('missing', pruefModus && !ok);
    }
    for (const s of ABSCHNITTE) {
      const st = abschnittStand(s);
      const head = document.querySelector(`.wb-sec[data-sid="${s.id}"]`);
      if (!head) continue;
      const ok = st.fertig >= st.gesamt;
      head.classList.toggle('done', ok);
      head.querySelector('.wb-sec-stat').textContent = st.fertig + '/' + st.gesamt;
      head.querySelector('.wb-sec-check').hidden = !ok;
    }
    const kopf = $('#wbKopf');
    if (kopf) {
      kopf.classList.toggle('done', kopfFertig());
      kopf.classList.toggle('missing', pruefModus && !kopfFertig());
    }
    const g = stand();
    const z = $('#wbStand');
    if (z) {
      z.textContent = `${g.fertig}/${g.gesamt} beantwortet`;
      z.classList.toggle('done', g.fertig >= g.gesamt);
    }
  }

  // Neuaufbau ohne Springen: Die Liste entsteht außerhalb der Seite und ersetzt die alte
  // in einem Schritt. Vorher wurde der Container geleert und Karte für Karte (mit Wartezeit
  // auf die Fotos) neu befüllt – die Seite war dazwischen kurz, und der Browser schob die
  // Ansicht nach oben. Zusätzlich bleibt das angetippte Element (Anker) auf derselben Höhe
  // am Bildschirm, auch wenn sich darüber etwas verändert (z. B. ein Textfeld klappt auf).
  let renderGen = 0;
  function ankerVon(el) {
    const k = el && el.closest && el.closest('.wb-item, .wb-sec');
    if (!k) return null;
    return k.classList.contains('wb-sec') ? `.wb-sec[data-sid="${k.dataset.sid}"]` : `.wb-item[data-pid="${k.dataset.pid}"]`;
  }

  async function render(anker) {
    const job = App.getCurrentJob();
    const cont = $('#wbAbschnitte');
    if (!job || !cont || !current) return;
    const gen = ++renderGen;
    setupInputs();
    const sel0 = anker || ankerVon(document.activeElement);
    const altEl = sel0 ? document.querySelector(sel0) : null;
    const altTop = altEl ? altEl.getBoundingClientRect().top : null;
    const alteUrls = activeUrls;
    activeUrls = [];

    // KW-Auswahl und Kopf
    const sel = $('#wbKw');
    sel.innerHTML = kwListe(job).map((k) => {
      const hat = liste(job).some((b) => b.kw === k);
      return `<option value="${escAttr(k)}"${k === current.kw ? ' selected' : ''}>${escHtml(kwText(k))} · ${escHtml(zeitraumText(k))}${hat ? ' ✓' : ''}</option>`;
    }).join('');
    const gp = $('#wbGespraech');
    if (document.activeElement !== gp) gp.value = current.gespraechspartner || '';

    const frag = document.createDocumentFragment();
    for (let i = 0; i < ABSCHNITTE.length; i++) {
      const s = ABSCHNITTE[i];
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'wb-sec' + (offen.has(s.id) ? ' open' : '');
      head.dataset.sid = s.id;
      head.innerHTML = `<span class="chev">${offen.has(s.id) ? '▼' : '▶'}</span>
        <span class="wb-sec-name">${i + 1}. ${escHtml(s.titel)}</span>
        <span class="grp-check wb-sec-check" hidden>✓</span>
        <span class="grp-stat wb-sec-stat"></span>`;
      head.onclick = () => {
        if (offen.has(s.id)) offen.delete(s.id); else offen.add(s.id);
        render(`.wb-sec[data-sid="${s.id}"]`);
      };
      frag.appendChild(head);
      if (!offen.has(s.id)) continue;
      const body = document.createElement('div');
      body.className = 'wb-sec-body';
      for (const p of s.punkte) body.appendChild(await karte(p));
      frag.appendChild(body);
    }
    if (gen !== renderGen) { activeUrls.forEach((u) => URL.revokeObjectURL(u)); activeUrls = alteUrls; return; }
    cont.replaceChildren(frag);
    alteUrls.forEach((u) => URL.revokeObjectURL(u));
    cont.querySelectorAll('textarea.wb-auto').forEach(autoHoehe);
    renderArchiv();
    aktualisiere();
    if (altTop != null) {
      const neu = document.querySelector(sel0);
      if (neu) window.scrollBy(0, neu.getBoundingClientRect().top - altTop);
    }
  }

  function renderArchiv() {
    const job = App.getCurrentJob();
    const cont = $('#wbArchiv');
    if (!job || !cont) return;
    const alle = liste(job).slice().sort((a, b) => String(b.kw).localeCompare(String(a.kw)));
    if (!alle.length) { cont.innerHTML = '<p class="hint">Noch kein Wochenbericht gespeichert.</p>'; return; }
    cont.innerHTML = '';
    for (const b of alle) {
      const div = document.createElement('div');
      div.className = 'diary-arch-item' + (current && b.id === current.id ? ' active' : '');
      const info = b.exportiertAm
        ? 'Word erstellt am ' + new Date(b.exportiertAm).toLocaleDateString('de-DE')
        : 'noch kein Word-Bericht';
      div.innerHTML = `<div class="da-main">
          <div class="da-date">${escHtml(kwText(b.kw))} · ${escHtml(zeitraumText(b.kw))}</div>
          <div class="da-snip">${escHtml((b.gespraechspartner ? 'Gesprächspartner: ' + b.gespraechspartner + ' · ' : '') + info)}</div>
        </div>
        <span class="da-go">öffnen ›</span>
        <button class="da-del" title="Bericht löschen">🗑</button>`;
      const open = async () => { await oeffne(b.kw); window.scrollTo(0, 0); };
      div.querySelector('.da-main').onclick = open;
      div.querySelector('.da-go').onclick = open;
      div.querySelector('.da-del').onclick = (ev) => { ev.stopPropagation(); loeschen(b); };
      cont.appendChild(div);
    }
  }

  // Bericht einer KW öffnen – vorhandenen, sonst einen neuen (erst bei Eingabe gespeichert).
  async function oeffne(kw) {
    await flush();
    const job = App.getCurrentJob();
    current = liste(job).find((b) => b.kw === kw) || leer(kw);
    pruefModus = false;
    await zaehleFotos();
    // Den ersten unvollständigen Abschnitt aufklappen.
    offen = new Set();
    const erster = ABSCHNITTE.find((s) => { const st = abschnittStand(s); return st.fertig < st.gesamt; });
    if (erster) offen.add(erster.id);
    await render();
  }

  async function loeschen(b) {
    const job = App.getCurrentJob();
    const praefix = NS + b.id + '__';
    const fotos = (await DB.getAllPhotos(job.id)).filter((p) => typeof p.nodeKey === 'string' && p.nodeKey.indexOf(praefix) === 0);
    const ok = await App.openConfirm('Wochenbericht löschen?',
      `<p>Wochenbericht <b>${escHtml(kwText(b.kw))}</b> wirklich löschen?</p>
       <p class="hint">${fotos.length ? fotos.length + ' Foto(s) werden mit gelöscht. ' : ''}Das kann nicht rückgängig gemacht werden.</p>`,
      'Löschen', true);
    if (!ok) return;
    for (const p of fotos) await DB.deletePhotoById(p.id);
    job.wochenberichte = liste(job).filter((x) => x.id !== b.id);
    await App.saveCurrentJob();
    if (current && current.id === b.id) current = null;
    await oeffne(current ? current.kw : kwKey(isoWoche(new Date())));
    App.toast('Wochenbericht gelöscht');
  }

  // --------------------------------------------------- aus Bautagebuch übernehmen
  const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  async function ausBautagebuch(a) {
    const job = App.getCurrentJob();
    const o = kwParse(current.kw);
    const mo = montag(o), so = plusTage(mo, 6);
    const von = Datum.heute(mo), bis = Datum.heute(so);
    const tage = (await DB.listDiary(job.id))
      .filter((d) => d.datum >= von && d.datum <= bis && voll(d.taetigkeiten))
      .sort((x, y) => (x.datum < y.datum ? -1 : 1));
    if (!tage.length) { App.toast(`Keine Bautagebuch-Tätigkeiten in ${kwText(current.kw)} gefunden.`); return; }
    const text = tage.map((d) => {
      const dt = new Date(d.datum + 'T12:00:00');
      return `${WT[dt.getDay()]} ${kurz(dt)}: ${String(d.taetigkeiten).replace(/\s+/g, ' ').trim()}`;
    }).join('\n');
    if (voll(a.text)) {
      const ok = await App.openConfirm('Text ersetzen?',
        '<p>Im Feld steht schon etwas. Durch die Tätigkeiten aus dem Bautagebuch ersetzen?</p>', 'Ersetzen');
      if (!ok) return;
    }
    a.text = text; a.nichts = false;
    await saveNow(); await render('.wb-item[data-pid="a1"]');
    App.toast(`${tage.length} Bautagebuch-Tag(e) übernommen`);
  }

  // ----------------------------------------------------------- Pflicht prüfen
  async function markiereOffene() {
    const fehlend = PFLICHT_PUNKTE.filter((p) => !punktFertig(p));
    for (const s of ABSCHNITTE) if (s.punkte.some((p) => fehlend.includes(p))) offen.add(s.id);
    pruefModus = true;
    await render();                        // setzt über aktualisiere() die roten Markierungen
    const kopf = $('#wbKopf');
    const erstes = !kopfFertig() ? kopf : document.querySelector('.wb-item.missing');
    if (erstes) erstes.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return fehlend.length + (kopfFertig() ? 0 : 1);
  }

  // ------------------------------------------------------------- Word-Bericht
  const AMPEL = {
    gruen: { fill: 'D7F0DF', color: '1F7A43', zeichen: '✓' },
    gelb: { fill: 'FFF1C7', color: '8A5A00', zeichen: '◐' },
    rot: { fill: 'F9D9D5', color: 'B03224', zeichen: '!' },
    grau: { fill: 'ECEFF2', color: '5A6672', zeichen: '–' },
  };
  const BLAU = '1F4E78';

  // Fotos für den Bericht verkleinern: in der App sind sie bis 2560 px groß, im Word-
  // Dokument reichen ~1400 px. Spart bei vielen Fotos zweistellige MB in der Mail.
  async function verkleinern(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const MAX = 1400;
      const f = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      if (f >= 1) { bmp.close(); return blob; }
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      return await new Promise((res) => c.toBlob((b) => res(b || blob), 'image/jpeg', 0.82));
    } catch (e) {
      return blob;
    }
  }
  async function fotoItems(pid) {
    const out = [];
    for (const ph of await fotosVon(pid)) out.push({ blob: await verkleinern(ph.blob), caption: ph.caption || '' });
    return out;
  }

  // Antwort eines Punkts als Klartext + Ampel für die Übersicht.
  function antwortText(p) {
    const a = current.antworten[p.id] || {};
    if (p.typ === 'frei') {
      if (a.nichts) return { text: p.nichts.replace(/^–\s*|\s*–$/g, ''), ampel: 'grau' };
      return { text: 'siehe Abschnitt', ampel: 'gruen' };
    }
    const opt = p.optionen.find((o) => o.v === a.status);
    if (!opt) return { text: 'offen', ampel: 'rot' };
    let text = opt.label;
    let ampel = opt.ampel;
    if (opt.unter) {
      const uo = opt.unter.optionen.find((o) => o.v === (a.unter || {}).status);
      if (uo) {
        text += ` · ${opt.unter.titel}: ${uo.label}`;
        if (uo.ampel === 'rot') ampel = 'rot';
      }
    }
    return { text, ampel };
  }

  // „Was fehlt? (Pflichtfeld)" -> „Was fehlt" – im Bericht folgt direkt der Doppelpunkt.
  const labelKurz = (l) => String(l).replace(/\s*\(Pflichtfeld\)/, '').replace(/[?:]\s*$/, '');

  async function erzeugeWord() {
    const job = App.getCurrentJob();
    const h = job.header || {};
    const doc = Docx.create();
    const o = kwParse(current.kw);

    // Briefkopf: Titel und Eckdaten links, Logo rechts.
    await doc.letterhead([
      Docx.pStyled('Wochenbericht Baustelle', { bold: true, sz: 36, color: BLAU, after: 0 }),
      Docx.pStyled(`${kwText(current.kw)} · ${zeitraumText(current.kw)}`, { bold: true, sz: 26, color: '2E6BA8', after: 160 }),
      Docx.pStyled('Filiale / Bauvorhaben: ' + (h.filiale || ''), { after: 0 }),
      Docx.pStyled('Ort: ' + (h.ort || ''), { after: 0 }),
      Docx.pStyled('Beauftragung: ' + (h.beauftragung || 'NFK Vollverkabelung'), { after: 0 }),
      Docx.pStyled('Gesprächspartner vor Ort: ' + current.gespraechspartner, { after: 0 }),
      Docx.pStyled('Erstellt am: ' + new Date().toLocaleDateString('de-DE'), { color: '5A6672', sz: 20, after: 0 }),
    ]);
    doc.push(Docx.pEmpty());

    // Ampel-Übersicht
    doc.push(Docx.pBar('Übersicht', BLAU));
    const W = [4300, 4000, 1338];
    const rows = [{ header: true, cells: [
      { text: 'Punkt', bold: true, fill: 'DCE6F1', color: BLAU },
      { text: 'Antwort', bold: true, fill: 'DCE6F1', color: BLAU },
      { text: 'Status', bold: true, fill: 'DCE6F1', color: BLAU, align: 'center' },
    ] }];
    ABSCHNITTE.forEach((s, i) => {
      rows.push({ cells: [{ text: `${i + 1}. ${s.titel}`, bold: true, fill: 'F3F6F9', color: BLAU },
        { text: '', fill: 'F3F6F9' }, { text: '', fill: 'F3F6F9' }] });
      for (const p of s.punkte) {
        if (p.typ === 'fotos') {
          const n = fotoZahl.get(p.id) || 0;
          rows.push({ cells: [{ text: p.titel.replace(/\s*\(.*\)$/, ''), sz: 20 },
            { text: n ? n + ' Foto(s)' : 'keine', sz: 20 },
            { text: AMPEL.grau.zeichen, fill: AMPEL.grau.fill, color: AMPEL.grau.color, bold: true, align: 'center' }] });
          continue;
        }
        const at = antwortText(p);
        const am = AMPEL[at.ampel] || AMPEL.grau;
        rows.push({ cells: [{ text: p.titel, sz: 20 }, { text: at.text, sz: 20 },
          { text: am.zeichen, fill: am.fill, color: am.color, bold: true, align: 'center' }] });
      }
    });
    doc.push(Docx.table(rows, W), Docx.pEmpty());
    doc.push(Docx.pStyled('✓ erledigt / in Ordnung   ◐ teilweise / in Arbeit   ! kritisch – bitte beachten   – neutral',
      { sz: 16, color: '5A6672' }));

    // Abschnitte im Detail
    for (let i = 0; i < ABSCHNITTE.length; i++) {
      const s = ABSCHNITTE[i];
      doc.push(Docx.pBar(`${i + 1}. ${s.titel}`, BLAU));
      for (const p of s.punkte) {
        const a = current.antworten[p.id] || {};
        doc.push(Docx.pStyled(p.titel, { bold: true, color: BLAU, after: 40, keepNext: true }));
        if (p.typ === 'wahl') {
          const at = antwortText(p);
          const am = AMPEL[at.ampel] || AMPEL.grau;
          doc.push(Docx.pStyled(at.text, { bold: true, color: am.color, after: 60 }));
          const opt = p.optionen.find((x) => x.v === a.status);
          if (opt && opt.text && voll(a.text)) doc.push(Docx.pStyled(labelKurz(opt.text.label) + ': ' + a.text, { after: 60 }));
          if (opt && opt.unter) {
            const uo = opt.unter.optionen.find((x) => x.v === (a.unter || {}).status);
            if (uo && uo.text && voll(a.unter.text)) doc.push(Docx.pStyled(labelKurz(uo.text.label) + ': ' + a.unter.text, { after: 60 }));
          }
          if (voll(a.notiz)) doc.push(Docx.pStyled('Notiz: ' + a.notiz, { italic: true, color: '5A6672', after: 60 }));
          if (opt && opt.fotos) await doc.photoGrid(await fotoItems(p.id));
        } else if (p.typ === 'frei') {
          doc.push(a.nichts ? Docx.pStyled(p.nichts, { color: '5A6672', after: 60 }) : Docx.pStyled(a.text, { after: 60 }));
          if (p.fotosFrei) await doc.photoGrid(await fotoItems(p.id));
        } else if (p.typ === 'fotos') {
          let irgendwas = false;
          for (const g of p.gruppen) {
            const items = await fotoItems(p.id + '-' + g.id);
            if (!items.length) continue;
            irgendwas = true;
            doc.push(Docx.pStyled(g.label, { bold: true, sz: 20, after: 40, keepNext: true }));
            await doc.photoGrid(items);
          }
          if (!irgendwas) doc.push(Docx.pStyled('keine Fortschrittsbilder', { color: '5A6672', after: 60 }));
        }
      }
    }
    return { blob: await doc.toBlob(), o };
  }

  function dateiname(job) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const h = job.header || {};
    const nr = App.filialNr(h.filiale) || (clean(h.filiale).match(/\d+/) || [])[0] || 'Projekt';
    const ort = clean(h.ort).replace(/\s+/g, '_');
    const o = kwParse(current.kw);
    return ['Wochenbericht', 'LI' + nr, ort, `KW${String(o.woche).padStart(2, '0')}_${o.jahr}`]
      .filter(Boolean).join('_').replace(/_+/g, '_') + '.docx';
  }

  async function exportieren() {
    if (!current) return;
    await saveNow();
    await zaehleFotos();
    const offenAnz = PFLICHT_PUNKTE.filter((p) => !punktFertig(p)).length + (kopfFertig() ? 0 : 1);
    if (offenAnz) {
      await markiereOffene();
      App.toast(`Noch ${offenAnz} Punkt(e) offen – rot markiert. Erst danach gibt es den Word-Bericht.`, 4500);
      return;
    }
    App.toast('Erzeuge Wochenbericht…');
    try {
      const job = App.getCurrentJob();
      const { blob } = await erzeugeWord();
      const name = dateiname(job);
      const geteilt = await App.shareFile(blob, name, Docx.MIME, `Wochenbericht ${kwText(current.kw)} ${(job.header || {}).filiale || ''}`.trim());
      if (geteilt) { current.exportiertAm = Date.now(); await saveNow(); renderArchiv(); }
    } catch (err) {
      console.error(err);
      App.toast('Wochenbericht fehlgeschlagen: ' + (err.message || err));
    }
  }

  // ------------------------------------------------------------- Einstieg
  async function enter() {
    const job = App.getCurrentJob();
    if (!job) return;
    // Rückkehr aus einem anderen Bereich: den zuletzt geöffneten Bericht weiterzeigen.
    // Nach einem Auftragswechsel hat reset() ihn verworfen – dann die aktuelle KW.
    if (current) { await zaehleFotos(); await render(); return; }
    await oeffne(kwKey(isoWoche(new Date())));
  }

  function init() {
    setupInputs();
    const sel = $('#wbKw');
    if (sel) sel.onchange = () => oeffne(sel.value);
    const gp = $('#wbGespraech');
    if (gp) gp.oninput = () => {
      current.gespraechspartner = gp.value;
      const kopf = $('#wbKopf');
      if (kopf && kopfFertig()) kopf.classList.remove('missing');
      scheduleSave(); aktualisiere();
    };
    const ex = $('#wbExportBtn');
    if (ex) ex.onclick = exportieren;
  }

  // Auftrag gewechselt: den geöffneten Bericht vergessen, damit er nicht im neuen landet.
  function reset() { current = null; fotoZahl = new Map(); pruefModus = false; }

  return { init, enter, flush, reset, ABSCHNITTE, isoWoche, kwKey };
})();
