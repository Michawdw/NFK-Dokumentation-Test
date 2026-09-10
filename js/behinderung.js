/* behinderung.js – Baubehinderungsanzeige gem. § 6 Abs. 1 VOB/B.
   Der Techniker erfasst Grund, betroffene Leistungen und voraussichtliche Dauer der
   Behinderung, hängt optional Fotos an und erzeugt daraus ein Word-Dokument im Aufbau
   der Vorlage „Baubehinderungsanzeige_Vorlage.docx" – mit Firmenlogo im Kopf und den
   Fotos als Anlage am Ende. Der Versand läuft über App.shareFile (Android-Share-Sheet
   -> E-Mail). Anders als Bilddoku/Bautagebuch ist die Ansicht NICHT durch die
   Vorprüfung gesperrt: eine Behinderung tritt oft schon beim Antreffen der Baustelle auf.

   Daten liegen am Job-Objekt (kein DB-Schema-Bump):
     job.behinderungen = [ { id, datum, behindertSeit, gewerk, bestellnummer,
                             empfaenger:{firma,ansprechpartner,strasse,plzOrt},
                             grund, betroffeneLeistungen, dauer,
                             unterzeichner:{name,funktion}, ortDatum,
                             erstelltAm, updatedAt } ]
   Fotos liegen im photos-Store mit reserviertem nodeKey '__behinderung__<id>'
   (Feld kind:'behinderung', caption) – dadurch tauchen sie nie in der Bilddoku auf.
   Die Absenderdaten der eigenen Firma gelten geräteweit: DB.getMeta('absender').
*/
const Behinderung = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const NS = '__behinderung__';
  const MIME = Docx.MIME;
  const REQUIRED = ['grund', 'betroffeneLeistungen', 'dauer'];

  // Fixtexte wörtlich aus der Vorlage.
  const TXT_BETREFF = 'Betreff: Behinderungsanzeige gem. § 6 Abs. 1 VOB/B';
  const TXT_ANREDE = 'Sehr geehrte Damen und Herren,';
  const TXT_HINWEIS = 'Wir weisen darauf hin, dass sich hierdurch die vertraglich vereinbarten '
    + 'Ausführungsfristen entsprechend verschieben. Etwaige Mehrkosten (z. B. durch '
    + 'Bauzeitverlängerung, Vorhaltekosten, Personal- und Gerätekosten) behalten wir uns vor, '
    + 'gesondert geltend zu machen.';
  const TXT_BITTE = 'Wir bitten um kurzfristige Rückmeldung sowie um Mitteilung, wann die '
    + 'Voraussetzungen für die Fortsetzung unserer Arbeiten vorliegen.';
  const TXT_GRUSS = 'Mit freundlichen Grüßen';

  // Briefkopf-Vorgabe: die Firmenanschrift aus assets/logo.png. Sie wird beim ersten
  // Aufruf als Absender eingesetzt und ist über „🏢 Absenderdaten" änderbar; gespeicherte
  // Werte haben Vorrang (DB-Meta 'absender').
  const DEFAULT_ABSENDER = {
    firma: 'WdW Retail',
    inhaber: 'Inhaber: Steffen Weißleder',
    strasse: 'Am Eichwald 13 a',
    plzOrt: '07422 Bad Blankenburg',
    telefon: 'Tel. +49 (0)36741 58 94 77',
    fax: 'Fax +49 (0)36741 58 94 89',
    mail: 'steffen.weissleder@wdw-retail.de',
    unterzeichner: '',
    funktion: '',
  };

  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let current = null;      // gerade bearbeitete Anzeige (im Speicher)
  let activeUrls = [];     // Object-URLs der Thumbnails (für Revoke)
  let cameraInput = null, galleryInput = null;

  const nodeKeyFor = (id) => NS + id;
  const today = () => Datum.heute();

  function list(job) {
    if (!job.behinderungen) job.behinderungen = [];
    return job.behinderungen;
  }

  // ---- Absenderdaten (geräteweit, mit Firmen-Vorgabe) ----
  async function getAbsender() {
    return Object.assign({}, DEFAULT_ABSENDER, (await DB.getMeta('absender')) || {});
  }
  function absenderComplete(a) {
    return !!(a && a.firma && String(a.firma).trim());
  }
  async function editAbsender() {
    const a = await getAbsender();
    App.openFormModal('Absenderdaten (eigene Firma)', [
      { name: 'firma', label: 'Firma / Absender', value: a.firma || '', required: true },
      { name: 'inhaber', label: 'Zusatz (z. B. Inhaber)', value: a.inhaber || '' },
      { name: 'strasse', label: 'Straße, Hausnummer', value: a.strasse || '' },
      { name: 'plzOrt', label: 'PLZ, Ort', value: a.plzOrt || '' },
      { name: 'telefon', label: 'Telefon', value: a.telefon || '' },
      { name: 'fax', label: 'Fax', value: a.fax || '' },
      { name: 'mail', label: 'E-Mail', value: a.mail || '' },
      { name: 'unterzeichner', label: 'Unterzeichner – Name', value: a.unterzeichner || '' },
      { name: 'funktion', label: 'Funktion / Firma', value: a.funktion || '' },
    ], (data) => {
      if (!data.firma) { App.toast('Firma ist erforderlich'); return false; }
      DB.setMeta('absender', data).then(async () => {
        // Leere Unterzeichner-Felder im offenen Formular nachziehen.
        const f = $('#bhForm');
        if (f) {
          if (!f.untName.value) f.untName.value = data.unterzeichner || '';
          if (!f.untFunktion.value) f.untFunktion.value = data.funktion || '';
        }
        await renderSenderBanner();
        App.toast('Absenderdaten gespeichert');
      });
    });
  }

  async function renderSenderBanner() {
    const el = $('#bhSenderBanner');
    if (!el) return;
    const a = await getAbsender();
    if (absenderComplete(a)) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = 'backup-banner info';
    el.innerHTML = '<div class="bk-msg">Absenderdaten der eigenen Firma sind noch nicht hinterlegt – '
      + 'sie erscheinen im Briefkopf der Anzeige.</div>';
  }

  // ---- versteckte File-Inputs (Kamera / Galerie) ----
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
    if (!files.length || !current) return;
    // Fotos hängen an der id der Anzeige – die muss vorher gespeichert sein,
    // sonst gingen sie beim Wechsel der Ansicht verloren.
    await save(true);
    const job = App.getCurrentJob();
    const nodeKey = nodeKeyFor(current.id);
    const deviceId = await DB.getDeviceId();
    for (const file of files) {
      try {
        const blob = await Photos.compress(file);
        const local = await DB.countPhotos(job.id, nodeKey);
        await DB.addPhoto({
          jobId: job.id, nodeKey, seq: local + 1, blob,
          createdAt: Date.now(), caption: '', kind: 'behinderung',
          srcId: deviceId + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        });
      } catch (err) {
        console.error(err);
        App.toast('Foto konnte nicht hinzugefügt werden: ' + App.fehlerText(err), 5000);
      }
    }
    await renderThumbs();
  }

  // ---- Formular ----
  function blankEntry(job) {
    const d = today();
    return {
      id: 'bh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      datum: d,
      behindertSeit: d,
      // Feste Vorbelegung (nicht aus job.header.beauftragung): die Stammdaten-
      // „Beauftragung" ist projektweit meist „NFK Vollverkabelung" und beträfe damit
      // praktisch nie die tatsächliche Firma – „Gewerk" bleibt trotzdem änderbar.
      gewerk: 'WdW Retail e.K.',
      bestellnummer: '',
      empfaenger: lastEmpfaenger(job),
      grund: '', betroffeneLeistungen: '', dauer: '',
      unterzeichner: { name: '', funktion: '' },
      ortDatum: defaultOrtDatum(job, d),
      erstelltAm: Date.now(), updatedAt: Date.now(),
    };
  }

  // Empfänger aus der zuletzt gespeicherten Anzeige übernehmen (spart Tipparbeit).
  // Bewusst KEIN Rückgriff auf den Ort aus den Stammdaten: Empfänger ist das
  // Generalunternehmen, dessen Anschrift meist eine andere ist als die der Baustelle.
  // Eine geratene Vorbelegung stünde sonst als halbe Anschrift im Schreiben – und
  // leere Felder sollen gerade weggelassen werden.
  function lastEmpfaenger(job) {
    const all = list(job || {});
    const last = all.length ? all[all.length - 1] : null;
    const e = (last && last.empfaenger) || {};
    return {
      firma: e.firma || '', ansprechpartner: e.ansprechpartner || '',
      strasse: e.strasse || '', plzOrt: e.plzOrt || '',
    };
  }

  function defaultOrtDatum(job, datum) {
    const ort = (job && job.header && job.header.ort) || '';
    if (!datum) return ort;
    const [y, m, d] = String(datum).split('-');
    return `${ort}, den ${d}.${m}.${y}`.trim();
  }

  async function fillForm(entry) {
    const f = $('#bhForm');
    if (!f) return;
    const e = entry.empfaenger || {};
    const u = entry.unterzeichner || {};
    const a = await getAbsender();
    f.empfFirma.value = e.firma || '';
    f.empfAnsprech.value = e.ansprechpartner || '';
    f.empfStrasse.value = e.strasse || '';
    f.empfPlzOrt.value = e.plzOrt || '';
    f.datum.value = entry.datum || today();
    f.behindertSeit.value = entry.behindertSeit || '';
    f.gewerk.value = entry.gewerk || '';
    f.bestellnummer.value = entry.bestellnummer || '';
    f.grund.value = entry.grund || '';
    f.betroffeneLeistungen.value = entry.betroffeneLeistungen || '';
    f.dauer.value = entry.dauer || '';
    f.untName.value = u.name || a.unterzeichner || '';
    f.untFunktion.value = u.funktion || a.funktion || '';
    f.ortDatum.value = entry.ortDatum || '';
    clearMissing();
  }

  function gather() {
    const f = $('#bhForm');
    const v = (name) => (f[name] ? f[name].value.trim() : '');
    return Object.assign({}, current, {
      empfaenger: {
        firma: v('empfFirma'), ansprechpartner: v('empfAnsprech'),
        strasse: v('empfStrasse'), plzOrt: v('empfPlzOrt'),
      },
      datum: f.datum.value,
      behindertSeit: f.behindertSeit.value,
      gewerk: v('gewerk'),
      bestellnummer: v('bestellnummer'),
      grund: v('grund'),
      betroffeneLeistungen: v('betroffeneLeistungen'),
      dauer: v('dauer'),
      unterzeichner: { name: v('untName'), funktion: v('untFunktion') },
      ortDatum: v('ortDatum'),
      updatedAt: Date.now(),
    });
  }

  function clearMissing() {
    $$('#bhForm label.missing').forEach((l) => l.classList.remove('missing'));
    const fotos = $('#bhPhotoBlock');
    if (fotos) fotos.classList.remove('missing');
  }

  // Markiert leere Pflichtfelder rot und springt zum ersten davon.
  // fotoAnzahl: Anzahl der angehängten Bilder – mindestens eines ist Pflicht.
  function flagMissing(model, fotoAnzahl) {
    clearMissing();
    const f = $('#bhForm');
    let first = null;
    for (const name of REQUIRED) {
      if ((model[name] || '').trim()) continue;
      const label = f[name] && f[name].closest('label');
      if (label) {
        label.classList.add('missing');
        if (!first) first = label;
      }
    }
    if (fotoAnzahl === 0) {
      const block = $('#bhPhotoBlock');
      if (block) {
        block.classList.add('missing');
        if (!first) first = block;
      }
    }
    if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return !first;
  }

  // Anzahl der Fotos der gerade bearbeiteten Anzeige.
  async function fotoAnzahl() {
    const job = App.getCurrentJob();
    if (!job || !current) return 0;
    return DB.countPhotos(job.id, nodeKeyFor(current.id));
  }

  // Schreibt den Formularstand in job.behinderungen (Upsert über die id).
  async function save(silent) {
    const job = App.getCurrentJob();
    if (!job || !current) return null;
    const model = gather();
    current = model;
    const all = list(job);
    const idx = all.findIndex((x) => x.id === model.id);
    if (idx >= 0) all[idx] = model; else all.push(model);
    await App.saveCurrentJob();
    await renderArchive();
    if (!silent) {
      const s = $('#bhSaved');
      if (s) { s.hidden = false; setTimeout(() => { s.hidden = true; }, 2000); }
      App.toast('Behinderungsanzeige gespeichert');
    }
    return model;
  }

  // ---- Archiv ----
  async function renderArchive() {
    const job = App.getCurrentJob();
    const cont = $('#bhArchive');
    if (!job || !cont) return;
    const all = list(job).slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    cont.innerHTML = '';
    if (!all.length) {
      cont.innerHTML = '<p class="hint">Noch keine Behinderungsanzeige gespeichert.</p>';
      return;
    }
    for (const entry of all) {
      const active = current && entry.id === current.id;
      const snippet = (entry.grund || entry.betroffeneLeistungen || '').replace(/\s+/g, ' ').slice(0, 80);
      const div = document.createElement('div');
      div.className = 'diary-arch-item' + (active ? ' active' : '');
      div.innerHTML = `<div class="da-main">
          <div class="da-date">${escHtml(Docx.fmtDate(entry.datum))}</div>
          <div class="da-snip">${escHtml(snippet || '—')}</div>
        </div>
        <span class="da-go">öffnen ›</span>
        <button class="da-del" title="Anzeige löschen">🗑</button>`;
      const open = async () => {
        current = entry;
        await fillForm(entry);
        await renderThumbs();
        await renderArchive();
        window.scrollTo(0, 0);
        App.toast('Anzeige vom ' + Docx.fmtDate(entry.datum) + ' geladen');
      };
      div.querySelector('.da-main').onclick = open;
      div.querySelector('.da-go').onclick = open;
      div.querySelector('.da-del').onclick = (ev) => { ev.stopPropagation(); deleteFlow(entry); };
      cont.appendChild(div);
    }
  }

  async function deleteFlow(entry) {
    const job = App.getCurrentJob();
    const photos = await DB.getPhotos(job.id, nodeKeyFor(entry.id));
    const ok = await App.openConfirm(
      'Behinderungsanzeige löschen?',
      `<p>Die Anzeige vom <b>${escHtml(Docx.fmtDate(entry.datum))}</b> wirklich löschen?</p>
       <p class="hint">${photos.length ? photos.length + ' zugehörige Foto(s) werden mit gelöscht. ' : ''}
       Das kann nicht rückgängig gemacht werden.</p>`,
      'Löschen', true);
    if (!ok) return;
    for (const p of photos) await DB.deletePhotoById(p.id);
    const all = list(job);
    const idx = all.findIndex((x) => x.id === entry.id);
    if (idx >= 0) all.splice(idx, 1);
    await App.saveCurrentJob();
    if (current && current.id === entry.id) await newEntry();
    await renderArchive();
    App.toast('Anzeige gelöscht');
  }

  async function newEntry() {
    const job = App.getCurrentJob();
    if (!job) return;
    current = blankEntry(job);
    await fillForm(current);
    await renderThumbs();
    await renderArchive();
    window.scrollTo(0, 0);
  }

  // ---- Fotos ----
  async function renderThumbs() {
    const cont = $('#bhPhotos');
    const job = App.getCurrentJob();
    if (!cont || !job || !current) return;
    activeUrls.forEach((u) => URL.revokeObjectURL(u));
    activeUrls = [];
    const photos = await DB.getPhotos(job.id, nodeKeyFor(current.id));
    cont.innerHTML = '';
    // Sobald ein Bild da ist, die Pflichtfeld-Markierung wieder aufheben.
    const block = $('#bhPhotoBlock');
    if (block && photos.length) block.classList.remove('missing');
    if (!photos.length) {
      cont.innerHTML = '<p class="hint">Noch kein Bild angehängt – mindestens eines ist erforderlich.</p>';
      return;
    }
    for (const ph of photos) {
      const url = URL.createObjectURL(ph.blob);
      activeUrls.push(url);
      const w = document.createElement('div');
      w.className = 'vp-thumb';
      w.innerHTML = `
        <img src="${url}" alt="" loading="lazy" />
        <input class="vp-cap" type="text" placeholder="Bildunterschrift"
          value="${escAttr(ph.caption || '')}" autocomplete="off" />
        <button type="button" class="vp-del" title="Foto entfernen">✕</button>`;
      w.querySelector('.vp-cap').onchange = async (ev) => {
        ph.caption = ev.target.value;
        await DB.updatePhoto(ph);
      };
      w.querySelector('.vp-del').onclick = async () => {
        const ok = await App.openConfirm('Foto entfernen?', '<p>Dieses Foto wirklich aus der Anzeige entfernen?</p>', 'Entfernen', true);
        if (!ok) return;
        await DB.deletePhotoById(ph.id);
        await renderThumbs();
      };
      cont.appendChild(w);
    }
  }

  // ---- Word-Dokument ----
  // model = gespeicherte Anzeige + { absender, filiale, ort, photos:[{blob,caption}] }
  async function generateBlob(model) {
    const doc = Docx.create();
    const a = model.absender || {};
    const e = model.empfaenger || {};
    const u = model.unterzeichner || {};

    // Briefkopf: Absenderanschrift links, Logo rechts – oben bündig auf einer Höhe.
    await doc.letterhead([
      Docx.pTight(a.firma || ''),
      a.inhaber ? Docx.pTight(a.inhaber) : null,
      a.strasse ? Docx.pTight(a.strasse) : null,
      a.plzOrt ? Docx.pTight(a.plzOrt) : null,
      a.telefon ? Docx.pTight(a.telefon) : null,
      a.fax ? Docx.pTight(a.fax) : null,
      a.mail ? Docx.pTight(a.mail) : null,
    ]);
    doc.push(Docx.pEmpty());

    // Anschriftenfeld des Empfängers. Jede Zeile ist optional – die Anschrift des
    // Generalunternehmens ist oft nicht bekannt. Nicht ausgefüllte Felder werden
    // weggelassen (keine Leerzeilen, kein Platzhalter im Schreiben); ist der ganze
    // Block leer, entfällt auch der Abstand darunter.
    const empfZeilen = [e.firma, e.ansprechpartner, e.strasse, e.plzOrt]
      .filter((z) => z && String(z).trim())
      .map((z) => Docx.pTight(z));
    doc.push(
      empfZeilen,
      empfZeilen.length ? Docx.pEmpty() : null,
      Docx.pRight(model.ortDatum || defaultOrtDatumFor(model)),
      Docx.pEmpty(),
      Docx.pBold(TXT_BETREFF),
      Docx.pTight('Bauvorhaben: ' + bauvorhaben(model)),
      Docx.pTight('Auftrags-/Bestellnummer: ' + (model.bestellnummer || '—')),
      Docx.pEmpty(),
      Docx.pText(TXT_ANREDE),
      Docx.pText(introSatz(model)),
      Docx.pBold('Grund der Behinderung:'),
      Docx.pText(model.grund || ''),
      Docx.pBold('Betroffene Leistungen:'),
      Docx.pText(model.betroffeneLeistungen || ''),
      Docx.pBold('Voraussichtliche Dauer der Behinderung:'),
      Docx.pText(model.dauer || ''),
      Docx.pText(TXT_HINWEIS),
      Docx.pText(TXT_BITTE),
      Docx.pEmpty(),
      Docx.pText(TXT_GRUSS),
      Docx.pEmpty(),
      u.name ? Docx.pTight(u.name) : null,
      u.funktion ? Docx.pTight(u.funktion) : null
    );

    // Anlage: Bilddokumentation (nur wenn Fotos vorhanden).
    const photos = (model.photos || []).filter((p) => p && p.blob);
    if (photos.length) {
      doc.push(
        Docx.pPageBreak(),
        Docx.pTitle('Anlage: Bilddokumentation'),
        Docx.pEmpty()
      );
      // Bildhöhe zusätzlich zur Breite begrenzt – sonst füllt ein Hochkantfoto (bei
      // 15 cm Breite ~20 cm hoch) fast eine ganze Seite. Mit 12 cm passen i. d. R.
      // zwei Fotos samt Bildunterschrift auf eine Seite.
      const PHOTO_MAX_H = 12 * Docx.EMU_PER_CM;
      for (const ph of photos) {
        await doc.image(ph.blob, { ext: 'jpeg', caption: ph.caption, maxHeightEmu: PHOTO_MAX_H });
      }
    }

    return doc.toBlob();
  }

  function bauvorhaben(model) {
    const fil = String(model.filiale || '').trim();
    const ort = String(model.ort || '').trim();
    if (!fil) return ort || '—';
    // Ort nicht doppeln – er steckt in „7265 Memmingen" oft schon drin.
    if (!ort || fil.toLowerCase().indexOf(ort.toLowerCase()) !== -1) return fil;
    return fil + ', ' + ort;
  }

  function defaultOrtDatumFor(model) {
    const ort = String(model.ort || '').trim();
    const d = Docx.fmtDate(model.datum);
    return [ort, d ? 'den ' + d : ''].filter(Boolean).join(', ');
  }

  function introSatz(model) {
    const gewerk = String(model.gewerk || '').trim();
    const seit = Docx.fmtDate(model.behindertSeit || model.datum);
    return 'hiermit zeigen wir gemäß § 6 Abs. 1 VOB/B an, dass die Ausführung unserer Leistungen'
      + (gewerk ? ' (Gewerk: ' + gewerk + ')' : '')
      + (seit ? ' seit dem ' + seit : '')
      + ' behindert wird.';
  }

  function buildName(model) {
    return Docx.buildFileName('Behinderungsanzeige', model, 'docx');
  }

  async function exportFile(model) {
    const blob = await generateBlob(model);
    const name = buildName(model);
    await App.shareFile(blob, name, MIME, `Behinderungsanzeige ${model.filiale || ''}`.trim());
    return name;
  }

  // Formular -> vollständiges Exportmodell (Kopfdaten, Absender, Fotos).
  async function buildExportModel() {
    const job = App.getCurrentJob();
    const h = (job && job.header) || {};
    const saved = await save(true);
    if (!saved) return null;
    const recs = await DB.getPhotos(job.id, nodeKeyFor(saved.id));
    return Object.assign({}, saved, {
      filiale: h.filiale || '',
      ort: h.ort || '',
      absender: await getAbsender(),
      photos: recs.map((r) => ({ blob: r.blob, caption: r.caption || '' })),
    });
  }

  async function exportDoc() {
    const job = App.getCurrentJob();
    if (!job || !current) return;
    // Mindestens ein Foto ist Pflicht – eine Behinderung ohne Bild ist im Streitfall
    // kaum belastbar. Das Speichern eines Entwurfs bleibt davon unberührt.
    const bilder = await fotoAnzahl();
    const model = gather();
    if (!flagMissing(model, bilder)) {
      // Nur das benennen, was wirklich fehlt – sonst sucht der Techniker am falschen Ende.
      const texteFehlen = REQUIRED.some((n) => !(model[n] || '').trim());
      App.toast(
        texteFehlen && bilder === 0
          ? 'Bitte alle Pflichtfelder ausfüllen und mindestens ein Foto anhängen.'
          : bilder === 0
            ? 'Bitte mindestens ein Foto anhängen.'
            : 'Bitte Grund, betroffene Leistungen und Dauer ausfüllen.');
      return;
    }
    const exportModel = await buildExportModel();
    if (!exportModel) return;
    if (!absenderComplete(exportModel.absender)) {
      App.toast('Bitte zuerst die Absenderdaten hinterlegen (🏢).');
      await renderSenderBanner();
      return;
    }
    App.toast('Erzeuge Behinderungsanzeige…');
    try {
      const name = await exportFile(exportModel);
      App.toast('Behinderungsanzeige erstellt: ' + name);
    } catch (err) {
      console.error(err);
      App.toast('Erstellung fehlgeschlagen: ' + (err.message || err));
    }
  }

  // ---- Lifecycle ----
  async function enter() {
    const job = App.getCurrentJob();
    if (!job) return;
    setupInputs();
    await renderSenderBanner();
    // Beim Betreten die zuletzt bearbeitete Anzeige weiterführen, sonst neue anlegen.
    const all = list(job);
    const stillThere = current && all.some((x) => x.id === current.id);
    if (!stillThere) {
      current = all.length
        ? all.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
        : blankEntry(job);
    }
    await fillForm(current);
    await renderThumbs();
    await renderArchive();
  }

  function init() {
    setupInputs();
    const bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    bind('#bhSenderBtn', editAbsender);
    bind('#bhNewBtn', newEntry);
    bind('#bhSaveBtn', () => save(false));
    bind('#bhExportBtn', exportDoc);
    bind('#bhCamBtn', () => cameraInput.click());
    bind('#bhGalBtn', () => galleryInput.click());
    const f = $('#bhForm');
    if (f) {
      f.addEventListener('submit', (e) => e.preventDefault());
      REQUIRED.forEach((name) => {
        if (f[name]) f[name].addEventListener('input', () => {
          const l = f[name].closest('label');
          if (l) l.classList.remove('missing');
        });
      });
      // Ort/Datum-Zeile mitziehen, solange sie nicht von Hand geändert wurde.
      f.datum.addEventListener('change', () => {
        const job = App.getCurrentJob();
        const auto = defaultOrtDatum(job, current && current.datum);
        if (!f.ortDatum.value || f.ortDatum.value === auto) {
          f.ortDatum.value = defaultOrtDatum(job, f.datum.value);
        }
        if (current) current.datum = f.datum.value;
      });
    }
  }

  return { init, enter, generateBlob, exportFile, buildName };
})();
