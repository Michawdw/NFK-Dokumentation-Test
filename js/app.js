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
  };

  function _switchView(viewId) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === viewId));
    $('#topTitle').textContent = viewTitles[viewId] || 'NFK Doku';
    $('#backBtn').hidden = (viewId === 'view-start');
    window.scrollTo(0, 0);
    if (viewId === 'view-start') { renderVpStatus(); renderBackupReminder('#backupReminderStart'); }
    if (viewId === 'view-vorpruefung') Vorpruefung.enter();
    if (viewId === 'view-bilddoku') enterBilddoku();
    if (viewId === 'view-bautagebuch') initDiaryView();
    if (viewId === 'view-behinderung') Behinderung.enter();
  }

  // Zugang zu Bilddoku/Bautagebuch erst, wenn die Vorprüfung des Auftrags vollständig
  // beantwortet ist. Andernfalls zur Vorprüfung springen und offene Punkte markieren.
  // Die Baubehinderungsanzeige ist bewusst NICHT gesperrt: eine Behinderung tritt oft
  // schon beim Antreffen der Baustelle auf, also vor Abschluss der Vorprüfung.
  function goGuard(target) {
    if ((target === 'view-bilddoku' || target === 'view-bautagebuch')
        && Vorpruefung.isIncomplete(currentJob)) {
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

  // ------------------------------------------------------------------- Helpers
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function openInfoModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalCancel').hidden = true;
    $('#modalOk').textContent = 'Schließen';
    const overlay = $('#modalOverlay');
    overlay.hidden = false;
    const close = () => { overlay.hidden = true; };
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
    overlay.hidden = false;
    $('#modalCancel').onclick = () => { overlay.hidden = true; };
    $('#modalClose').onclick = () => { overlay.hidden = true; }; // ✕ = Abbrechen
    $('#modalOk').onclick = () => {
      const data = {};
      $$('#modalBody [name]').forEach((el) => { data[el.name] = el.value.trim(); });
      const ok = onSubmit(data);
      if (ok !== false) overlay.hidden = true;
    };
  }

  // Bestätigungs-Dialog. Liefert ein Promise<boolean> (true = bestätigt).
  function openConfirm(title, html, okLabel, danger) {
    return new Promise((resolve) => {
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = html;
      const cancel = $('#modalCancel'), ok = $('#modalOk'), overlay = $('#modalOverlay');
      cancel.hidden = false;
      cancel.textContent = 'Abbrechen';
      ok.textContent = okLabel || 'OK';
      ok.classList.toggle('danger', !!danger);
      overlay.hidden = false;
      const finish = (val) => {
        overlay.hidden = true;
        ok.classList.remove('danger');
        ok.textContent = 'OK';
        overlay.onclick = null;
        resolve(val);
      };
      cancel.onclick = () => finish(false);
      $('#modalClose').onclick = () => finish(false); // ✕ = Abbrechen (Promise auflösen!)
      ok.onclick = () => finish(true);
      overlay.onclick = (e) => { if (e.target === overlay) finish(false); }; // Tippen daneben = Abbrechen
    });
  }

  async function shareFile(blob, filename, mime, title) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: title || filename });
        toast('Geteilt: ' + filename);
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // Nutzer hat abgebrochen
        // sonst Fallback Download
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast('Gespeichert: ' + filename);
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
    currentJob = job;
    await DB.setCurrentJobId(id);
    catalogNames = null; // Katalog/Vorlage neu für diesen Auftrag laden
    await loadStartView();
    toast('Auftrag „' + (job.name || job.header.filiale || '') + '" geöffnet');
  }

  async function renderJobList() {
    const cont = $('#jobList');
    if (!cont) return;
    const jobs = await DB.listJobs();
    cont.innerHTML = '';
    for (const j of jobs) {
      const active = currentJob && j.id === currentJob.id;
      const div = document.createElement('div');
      div.className = 'job-item' + (active ? ' active' : '');
      const sub = [j.header.filiale, j.header.ort, j.header.datum].filter(Boolean).join(' · ');
      div.innerHTML = `<div class="job-main">
          <div class="job-name">${escHtml(j.name || j.header.filiale || 'Auftrag')}</div>
          <div class="job-sub">${escHtml(sub)}</div>
        </div>
        <button class="job-edit" title="Umbenennen">✎</button>
        <button class="job-del" title="Löschen">🗑</button>`;
      div.querySelector('.job-main').onclick = () => { if (!active) switchJob(j.id); };
      div.querySelector('.job-edit').onclick = (e) => { e.stopPropagation(); renameJob(j); };
      div.querySelector('.job-del').onclick = (e) => { e.stopPropagation(); deleteJobFlow(j); };
      cont.appendChild(div);
    }
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
      catalogNames = null;
      await ensureCurrentJob();
    }
    await loadStartView();
    toast('Auftrag gelöscht');
  }

  async function newJobFlow() {
    const job = await DB.createJob('Auftrag ' + ((await DB.listJobs()).length + 1));
    currentJob = job;
    await DB.setCurrentJobId(job.id);
    catalogNames = null;
    await loadStartView();
    // Kein direkter Sprung: erst Stammdaten ausfüllen + speichern, danach folgt die
    // Vorprüfung automatisch (siehe saveProjectForm).
    toast('Neuer Auftrag – bitte Stammdaten ausfüllen und speichern');
  }

  // Füllt Auftragsliste + Projektkopf-Formular des aktiven Auftrags.
  async function loadStartView() {
    await renderJobList();
    const h = (currentJob && currentJob.header) || {};
    const f = $('#projectForm');
    f.filiale.value = h.filiale || '';
    f.ort.value = h.ort || '';
    f.datum.value = h.datum || new Date().toISOString().slice(0, 10);
    f.beauftragung.value = h.beauftragung || 'NFK Vollverkabelung';
    renderVpStatus();
    await renderBackupReminder('#backupReminderStart');
  }

  // Zeigt auf der Startseite den Vorprüfungs-Status des aktiven Auftrags (Link zur View).
  function renderVpStatus() {
    const el = $('#vpStatus');
    if (!el) return;
    if (!currentJob) { el.hidden = true; return; }
    const total = Vorpruefung.POINTS.length;
    const answered = Vorpruefung.answeredCount(currentJob);
    const done = !!(currentJob.vorpruefung && currentJob.vorpruefung.done);
    el.hidden = false;
    if (done) {
      el.className = 'vp-status ok';
      el.innerHTML = `<span>🔍 Vorprüfung ✓ abgeschlossen</span>
        <button type="button" class="btn ghost vp-open">📄 Protokoll / ansehen</button>`;
    } else {
      el.className = 'vp-status open';
      el.innerHTML = `<span>🔍 Vorprüfung offen (${answered}/${total} beantwortet)</span>
        <button type="button" class="btn primary vp-open">Vorprüfung öffnen</button>`;
    }
    const btn = el.querySelector('.vp-open');
    if (btn) btn.onclick = () => show('view-vorpruefung');
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
    const unsaved = photos.filter((p) => (p.createdAt || 0) > last).length;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const ago = days === null ? '' : days <= 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`;

    let cls, msg;
    if (unsaved > 0) {
      cls = (!last || days >= 1) ? 'warn' : 'info';
      msg = !last
        ? `⚠ Noch nie gesichert – ${photos.length} Bild${photos.length === 1 ? '' : 'er'} nur auf diesem Handy.`
        : `⚠ ${unsaved} neue${unsaved === 1 ? 's Bild' : ' Bilder'} seit der letzten Sicherung (${ago}).`;
    } else {
      cls = 'ok';
      msg = `✓ Alle Bilder gesichert (zuletzt ${ago}).`;
    }

    el.className = 'backup-banner ' + cls;
    el.hidden = false;
    el.innerHTML = `<span class="bk-msg"></span>` +
      `<button type="button" class="btn primary bk-save">💾 Jetzt sichern</button>`;
    el.querySelector('.bk-msg').textContent = msg;
    el.querySelector('.bk-save').onclick = doBackupNow;
  }

  // Erzeugt den vollen Bilddoku-ZIP (= komplette Sicherung) und merkt den Zeitpunkt.
  async function doBackupNow() {
    toast('Erzeuge Sicherung…');
    try {
      const res = await ExportZip.build();
      if (res && res.totalPhotos) {
        currentJob.lastBackupAt = Date.now();
        await DB.saveJob(currentJob);
        toast('Sicherung erstellt – bitte in Drive/Chat ablegen.');
      }
    } catch (e) {
      console.error(e);
      toast('Sicherung fehlgeschlagen: ' + (e.message || e));
    }
    await renderBackupReminder('#backupReminder');
    await renderBackupReminder('#backupReminderStart');
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
  }

  function populateTemplateSelect(selected) {
    const sel = $('#templateSelect');
    const names = (catalogNames || []).slice();
    // „Eigener Import" als Option zeigen, falls aktiv und nicht im Katalog.
    if (selected && selected !== '' && names.indexOf(selected) === -1) names.unshift(selected);
    sel.innerHTML = names.map((n) =>
      `<option value="${escAttr(n)}"${n === selected ? ' selected' : ''}>${escHtml(n)}</option>`).join('');
    if (!names.length) sel.innerHTML = '<option value="">— keine Vorlage —</option>';
  }

  async function onTemplateChange() {
    const name = $('#templateSelect').value;
    if (!name || name === Structure.EXTERNAL_LABEL) return;
    toast('Lade Vorlage…');
    try {
      await Structure.importFromCatalog(name);
      await renderTree();
      toast('Vorlage „' + name + '" geladen');
    } catch (e) {
      console.error(e);
      toast('Vorlage konnte nicht geladen werden');
    }
  }

  async function refreshCatalog() {
    toast('Aktualisiere Vorlagen…');
    try {
      catalogNames = await Structure.listTemplates();
      const selected = await Structure.getSelectedTemplate();
      // Aktuell gewählte Vorlage neu einlesen (falls Tab geändert wurde).
      if (selected && catalogNames.indexOf(selected) !== -1) {
        await Structure.importFromCatalog(selected);
        await renderTree();
      }
      populateTemplateSelect(selected);
      toast(catalogNames.length + ' Vorlage(n) verfügbar');
    } catch (e) {
      console.error(e);
      toast('Aktualisieren fehlgeschlagen (offline?)');
    }
  }

  // Aufklapp-Zustand des Baums (bleibt über Re-Renders erhalten; Default: alles zu).
  const expandedObers = new Set();
  const expandedUnters = new Set();
  function toggleSet(set, key) { if (set.has(key)) set.delete(key); else set.add(key); }

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
    return nodes.some((n) => n.source === 'merge') ? ORIGIN.merge : ORIGIN.custom;
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
  const fremdHinweis = (o, fotos) => (o === ORIGIN.merge && fotos > 0)
    ? '<p class="hint">Achtung: Diese Bilder stammen von einem Kollegen und wurden über „Beiträge zusammenführen" übernommen.</p>'
    : '';

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

  async function renderTree() {
    const info = $('#templateInfo');
    const tree = $('#structureTree');
    revokeThumbs();

    const nodes = await Structure.getMerged();
    const tplCount = ((currentJob && currentJob.structure) || []).length;
    info.textContent = nodes.length
      ? `${nodes.length} Positionen (${tplCount} aus Vorlage, ${nodes.length - tplCount} eigene).`
      : 'Vorlage wird geladen … (oben auswählen oder eigene Excel importieren).';

    if (nodes.length === 0) { tree.innerHTML = ''; return; }

    const enriched = await Overview.enrich(nodes);
    const grp = Structure.groupForDisplay(enriched);

    tree.innerHTML = '';
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
      head.innerHTML = `<span class="chev">${oberExpanded ? '▼' : '▶'}</span>
        <span class="grp-name">${escHtml(ober)}${oberOrigin ? ` <span class="origin-tag ${oberOrigin.cls}" title="${escAttr(oberOrigin.title)}">${escHtml(oberOrigin.short)}</span>` : ''}</span>
        ${oberAllDone ? '<span class="grp-check" title="alle Pflichtbilder erledigt">✓</span>' : ''}
        ${oberNotNeeded
          ? '<span class="grp-stat skip">nicht benötigt</span>'
          : `<span class="grp-stat${oberAllDone ? ' done' : ''}">${oberDone}/${needed.length}</span>`}
        <button class="skip-btn" title="${oberSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${oberSkip ? '↩' : '∅'}</button>
        ${oberOrigin ? '<button class="del-btn" title="Bereich mit allen Positionen löschen">🗑</button>' : ''}`;
      head.onclick = () => { toggleSet(expandedObers, ober); renderTree(); };
      head.querySelector('.skip-btn').onclick = (e) => { e.stopPropagation(); toggleSkip('obers', ober); };
      const oberDel = head.querySelector('.del-btn');
      if (oberDel) oberDel.onclick = (e) => {
        e.stopPropagation();           // sonst klappt nur der Ordner auf/zu
        deleteCustomFolderFlow(allNodes, ober, 'obers', ober);
      };
      tree.appendChild(head);

      if (!oberExpanded) continue; // Inhalt zugeklappter Ordner wird nicht gebaut

      const body = document.createElement('div');
      body.className = 'tree-body';
      tree.appendChild(body);

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
          uHead.innerHTML = `<span class="chev">${uExpanded ? '▼' : '▶'}</span>
            <span class="grp-name">${escHtml(uk)}${uOrigin ? ` <span class="origin-tag ${uOrigin.cls}" title="${escAttr(uOrigin.title)}">${escHtml(uOrigin.short)}</span>` : ''}</span>
            ${uAllDone ? '<span class="grp-check" title="alle Pflichtbilder erledigt">✓</span>' : ''}
            ${uNotNeeded
              ? '<span class="grp-stat skip">nicht benötigt</span>'
              : `<span class="grp-stat${uAllDone ? ' done' : ''}">${uDone}/${uNeeded.length}</span>`}
            <button class="skip-btn" title="${uSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${uSkip ? '↩' : '∅'}</button>
            ${uOrigin ? '<button class="del-btn" title="Unterordner mit allen Positionen löschen">🗑</button>' : ''}`;
          uHead.onclick = () => { toggleSet(expandedUnters, uKey); renderTree(); };
          uHead.querySelector('.skip-btn').onclick = (e) => { e.stopPropagation(); toggleSkip('unters', uKey); };
          const uDel = uHead.querySelector('.del-btn');
          if (uDel) uDel.onclick = (e) => {
            e.stopPropagation();
            deleteCustomFolderFlow(list, uk, 'unters', uKey);
          };
          body.appendChild(uHead);

          if (uExpanded) {
            const uBody = document.createElement('div');
            uBody.className = 'tree-body';
            body.appendChild(uBody);
            for (const n of list) uBody.appendChild(await nameRow(n));
          }
        } else {
          // Positionen direkt im Oberordner (ohne Unterordner)
          for (const n of list) body.appendChild(await nameRow(n));
        }
      }
    }
  }

  async function nameRow(n) {
    const origin = originOf(n);
    const row = document.createElement('div');
    row.className = 'name-row' + (n.done ? ' done' : '') + (n.skipped ? ' skipped' : '')
      + (origin ? ' origin-' + origin.cls : '');
    const nodeSkip = (skipSet('nodes')).includes(n.key);
    let statusLine;
    if (n.skipped) {
      // Abzeichen auch hier anhängen – sonst verschwindet die Herkunft, sobald eine
      // Position auf „nicht benötigt" steht.
      statusLine = 'nicht benötigt';
    } else {
      statusLine = n.done ? '<span class="row-check">✓</span> erledigt' : 'offen';
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
        <button class="skip-btn" title="${nodeSkip ? 'wieder benötigt' : 'als nicht benötigt markieren'}">${nodeSkip ? '↩' : '∅'}</button>
        <button class="gal-btn" title="Aus Galerie">🖼️</button>
        <button class="cam-btn" title="Foto aufnehmen">📷</button>
        ${origin ? '<button class="del-btn" title="Eigenen Namen löschen">🗑</button>' : ''}
      </div>`;

    row.querySelector('.skip-btn').onclick = () => toggleSkip('nodes', n.key);
    row.querySelector('.cam-btn').onclick = () => pickPhoto(n, true);
    row.querySelector('.gal-btn').onclick = () => pickPhoto(n, false);
    const del = row.querySelector('.del-btn');
    if (del) del.onclick = () => deleteCustomNameFlow(n);

    const thumbs = row.querySelector('.thumbs');
    const photos = await DB.getPhotos(currentJob.id, n.key);
    for (const p of photos) {
      const url = URL.createObjectURL(p.blob);
      activeUrls.push(url);
      const wrap = document.createElement('div');
      wrap.className = 'thumb-wrap';
      wrap.innerHTML = `<img src="${url}" alt="" loading="lazy" /><span class="thumb-seq">${String(p.seq).padStart(2, '0')}</span>`;
      wrap.onclick = () => openPhotoViewer(n, p, url);
      thumbs.appendChild(wrap);
    }
    return row;
  }

  // Bild groß anzeigen (damit auf dem Handy erkennbar ist, um welches Bild es geht)
  // mit der Möglichkeit, genau dieses Bild zu löschen.
  function openPhotoViewer(node, photo, url) {
    const overlay = $('#photoOverlay');
    $('#photoTitle').textContent = node.bildname;
    $('#photoSub').textContent = 'Bild ' + String(photo.seq).padStart(2, '0') +
      (node.unter ? ' · ' + node.unter : '') + ' · ' + node.ober;
    $('#photoImg').src = url;
    overlay.hidden = false;

    const close = () => {
      overlay.hidden = true;
      overlay.onclick = null;
      $('#photoImg').removeAttribute('src'); // Object-URL nicht länger als nötig binden
    };
    $('#photoClose').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); }; // daneben tippen = schließen

    $('#photoDelete').onclick = async () => {
      const ok = await openConfirm(
        'Bild löschen?',
        `<p>Bild <b>${String(photo.seq).padStart(2, '0')}</b> von
         „${escHtml(node.bildname)}" wirklich löschen?</p>
         <p class="hint">Das Bild wird endgültig vom Gerät entfernt. Die übrigen Bilder
         dieser Position werden anschließend neu durchnummeriert.</p>`,
        'Löschen', true);
      if (!ok) return;
      close();
      try {
        await Photos.deleteFromNode(node.key, photo.id);
        await renderTree();
        await renderBackupReminder('#backupReminder');
        toast('Bild gelöscht');
      } catch (err) {
        console.error(err);
        toast('Fehler beim Löschen des Bildes');
      }
    };
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

  async function onPhotosSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // erlaubt erneute Auswahl derselben Datei
    if (!files.length || !currentNode) return;
    toast(files.length > 1 ? `Verarbeite ${files.length} Bilder…` : 'Verarbeite Bild…');
    try {
      for (const file of files) {
        await Photos.addToNode(currentNode, file);
      }
      await renderTree();
      await renderBackupReminder('#backupReminder');
      toast('Gespeichert');
    } catch (err) {
      console.error(err);
      toast('Fehler beim Speichern des Bildes');
    }
  }

  // ------------------------------------------------- Eigenen Namen anlegen
  async function addCustomNameFlow() {
    const nodes = await Structure.getMerged();
    const obers = Array.from(new Set(nodes.map((n) => n.ober)));
    const oberOptions = [{ value: '__new__', label: '➕ Neuer Bereich…' }]
      .concat(obers.map((o) => ({ value: o, label: o })));

    openFormModal('Eigenen Namen anlegen', [
      { name: 'oberSelect', label: 'Bereich (Oberordner)', type: 'select', options: oberOptions, value: obers[0] || '__new__' },
      { name: 'oberNew', label: 'Neuer Bereich (falls oben „Neuer Bereich")', placeholder: 'z. B. 06_Sonstiges' },
      { name: 'unter', label: 'Unterordner (optional)', placeholder: 'leer = direkt im Bereich' },
      { name: 'bildname', label: 'Bildname', placeholder: 'z. B. Detailaufnahme', required: true },
      { name: 'pflicht', label: 'Pflichtanzahl', type: 'number', value: '1' },
    ], async (data) => {
      let ober = data.oberSelect === '__new__' ? (data.oberNew || '').trim() : data.oberSelect;
      const bildname = (data.bildname || '').trim();
      if (!ober) ober = 'Allgemein';
      if (!bildname) { toast('Bildname fehlt'); return false; }
      const unter = (data.unter || '').trim() || null;
      let pflicht = parseInt(data.pflicht, 10);
      if (!Number.isFinite(pflicht) || pflicht < 0) pflicht = 1;
      const node = {
        key: Structure.makeKey(ober, unter, bildname),
        ober, unter, bildname, pflicht, source: 'custom',
      };
      await Structure.addCustomName(node);
      await renderTree();
      toast('Name angelegt');
    });
  }

  // -------------------------------------------------- Template importieren
  async function importTemplate(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const nodes = await Structure.importFile(file);
      await renderTree();
      populateTemplateSelect(Structure.EXTERNAL_LABEL);
      toast(`Eigene Vorlage importiert: ${nodes.length} Positionen`);
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + (err.message || err));
    }
  }

  // ------------------------------------------------------- Bautagebuch-View
  let diaryDate = null;

  async function initDiaryView() {
    const f = $('#diaryForm');
    const h = (currentJob && currentJob.header) || {};
    if (!diaryDate) diaryDate = h.datum || new Date().toISOString().slice(0, 10);
    f.datum.value = diaryDate;
    await loadDiaryForDate(diaryDate);
    await renderDiaryArchive();
    f.datum.onchange = async () => { diaryDate = f.datum.value; await loadDiaryForDate(diaryDate); await renderDiaryArchive(); };
  }

  function fmtDate(datum) {
    if (!datum) return '';
    const [y, m, d] = datum.split('-');
    return `${d}.${m}.${y}`;
  }

  // Liste der gespeicherten Bautagebuch-Tage des aktuellen Auftrags (neueste zuerst).
  async function renderDiaryArchive() {
    const cont = $('#diaryArchive');
    if (!cont || !currentJob) return;
    const days = await DB.listDiary(currentJob.id);
    if (!days.length) {
      cont.innerHTML = '<p class="hint">Noch keine Bautagebücher gespeichert. Trage unten einen Tag ein und tippe „Tag speichern".</p>';
      return;
    }
    cont.innerHTML = '';
    for (const day of days) {
      const active = day.datum === diaryDate;
      const snippet = (day.taetigkeiten || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const div = document.createElement('div');
      div.className = 'diary-arch-item' + (active ? ' active' : '');
      div.innerHTML = `<div class="da-main">
          <div class="da-date">${fmtDate(day.datum)}</div>
          <div class="da-snip">${escHtml(snippet || '—')}</div>
        </div>
        <span class="da-go">öffnen ›</span>
        <button class="da-del" title="Tag löschen">🗑</button>`;
      div.querySelector('.da-main').onclick = async () => {
        diaryDate = day.datum;
        $('#diaryForm').datum.value = day.datum;
        await loadDiaryForDate(day.datum);
        await renderDiaryArchive();
        window.scrollTo(0, 0);
        toast('Tag ' + fmtDate(day.datum) + ' geladen – bearbeitbar');
      };
      div.querySelector('.da-go').onclick = div.querySelector('.da-main').onclick;
      div.querySelector('.da-del').onclick = (e) => { e.stopPropagation(); deleteDiaryFlow(day); };
      cont.appendChild(div);
    }
  }

  async function deleteDiaryFlow(day) {
    const ok = await openConfirm(
      'Bautagebuch-Tag löschen?',
      `<p>Den Tag <b>${fmtDate(day.datum)}</b> wirklich löschen?</p>
       <p class="hint">Die Eingaben dieses Tages werden entfernt. Das kann nicht rückgängig
       gemacht werden.</p>`,
      'Löschen', true);
    if (!ok) return;
    await DB.deleteDiary(currentJob.id, day.datum);
    if (day.datum === diaryDate) await loadDiaryForDate(diaryDate); // Formular leeren/auffrischen
    await renderDiaryArchive();
    toast('Tag ' + fmtDate(day.datum) + ' gelöscht');
  }

  async function loadDiaryForDate(datum) {
    const f = $('#diaryForm');
    const saved = await DB.getDiary(currentJob.id, datum);
    const techs = (currentJob && currentJob.header && currentJob.header.techniker) || [];

    if (saved) {
      f.anzTechniker.value = (saved.anzTechniker != null) ? saved.anzTechniker : techs.length;
      f.taetigkeiten.value = saved.taetigkeiten || '';
      f.behinderungen.value = saved.behinderungen || '';
      f.vorkommnisse.value = saved.vorkommnisse || '';
      f.ortDatum.value = saved.ortDatum || defaultOrtDatum(datum);
      renderDiaryRows(saved.rows || techs.map((t) => ({ name: t })));
    } else {
      f.anzTechniker.value = techs.length || '';
      f.taetigkeiten.value = '';
      f.behinderungen.value = '';
      f.vorkommnisse.value = '';
      f.ortDatum.value = defaultOrtDatum(datum);
      renderDiaryRows(techs.map((t) => ({ name: t })));
    }
  }

  function defaultOrtDatum(datum) {
    const ort = (currentJob && currentJob.header && currentJob.header.ort) || '';
    if (!datum) return ort;
    const [y, m, d] = datum.split('-');
    return `${ort} ${d}.${m}.${y}`.trim();
  }

  function renderDiaryRows(rows) {
    const cont = $('#diaryRows');
    cont.innerHTML = '';
    const data = (rows || []).slice(0, 5);
    while (data.length < 5) data.push({});
    data.forEach((r, i) => {
      const div = document.createElement('div');
      div.className = 'diary-row';
      div.innerHTML = `
        <input class="dr-name" type="text" placeholder="Techniker ${i + 1}" value="${escAttr(r.name || '')}" autocomplete="off" />
        <div class="dr-times">
          <label>Start<input class="dr-start" type="time" value="${escAttr(r.start || '')}" /></label>
          <label>Ende<input class="dr-ende" type="time" value="${escAttr(r.ende || '')}" /></label>
          <label>Pause<input class="dr-pause" type="time" value="${escAttr(r.pause || '')}" /></label>
        </div>
        <textarea class="dr-bem" rows="1" placeholder="Bemerkung">${escHtml(r.bemerkung || '')}</textarea>`;
      cont.appendChild(div);
    });
  }

  function gatherDiary() {
    const f = $('#diaryForm');
    const rows = $$('#diaryRows .diary-row').map((d) => ({
      name: d.querySelector('.dr-name').value.trim(),
      start: d.querySelector('.dr-start').value,
      ende: d.querySelector('.dr-ende').value,
      pause: d.querySelector('.dr-pause').value,
      bemerkung: d.querySelector('.dr-bem').value.trim(),
    })).filter((r) => r.name || r.start || r.ende || r.pause || r.bemerkung);

    return {
      datum: f.datum.value,
      anzTechniker: f.anzTechniker.value,
      rows,
      taetigkeiten: f.taetigkeiten.value,
      behinderungen: f.behinderungen.value,
      vorkommnisse: f.vorkommnisse.value,
      ortDatum: f.ortDatum.value.trim(),
    };
  }

  async function saveDiary() {
    const model = gatherDiary();
    if (!model.datum) { toast('Datum fehlt'); return; }
    await DB.saveDiary(currentJob.id, model);
    await renderDiaryArchive();
    const s = $('#diarySaved');
    s.hidden = false; setTimeout(() => { s.hidden = true; }, 2000);
    toast('Tag gespeichert');
  }

  async function exportDiary() {
    const model = gatherDiary();
    if (!model.datum) { toast('Datum fehlt'); return; }
    await DB.saveDiary(currentJob.id, model); // immer mitspeichern
    await renderDiaryArchive();
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
    window.addEventListener('popstate', () => _switchView('view-start'));
    $$('[data-go]').forEach((b) => b.onclick = () => goGuard(b.dataset.go));
    $('#projectForm').addEventListener('submit', saveProjectForm);
    $('#newJobBtn').onclick = newJobFlow;
    $('#importTemplate').addEventListener('change', importTemplate);
    $('#templateSelect').addEventListener('change', onTemplateChange);
    $('#tplRefreshBtn').onclick = refreshCatalog;
    $('#addCustomBtn').onclick = addCustomNameFlow;
    $('#overviewBtn').onclick = () => Overview.show();
    // ZIP-Export = vollständige Sicherung: über doBackupNow, damit der Zeitpunkt
    // gemerkt und die Backup-Erinnerung aktualisiert wird.
    $('#exportZipBtn').onclick = doBackupNow;
    $('#handoverExportBtn').onclick = handoverExport;
    $('#handoverImport').addEventListener('change', handoverImport);
    $('#mergeImport').addEventListener('change', mergeContribution);
    $('#diarySaveBtn').onclick = saveDiary;
    $('#diaryExportBtn').onclick = exportDiary;
    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'modalOverlay') e.currentTarget.hidden = true;
    });
  }

  function updateNetDot() {
    $('#netDot').classList.toggle('offline', !navigator.onLine);
  }

  // Zeigt unten auf der Startseite die installierte App-Version an. Autoritativ ist
  // die Cache-Version des laufenden Service Workers (per Nachricht abgefragt); solange
  // die noch nicht geantwortet hat, dient APP_VERSION als Sofort-Anzeige/Fallback.
  const APP_VERSION = 'v35'; // Bei jeder App-Änderung zusammen mit CACHE in sw.js erhöhen.
  function renderAppVersion(v) {
    const el = $('#appVersion');
    if (!el) return;
    const clean = String(v || APP_VERSION).replace('nfk-doku-', '');
    el.textContent = 'Version ' + clean;
  }
  function initAppVersion() {
    renderAppVersion();
    if (!('serviceWorker' in navigator)) return;
    const ask = () => {
      if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage('GET_VERSION');
    };
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'VERSION') renderAppVersion(e.data.version);
    });
    navigator.serviceWorker.addEventListener('controllerchange', ask);
    ask();
  }

  async function init() {
    // Robust starten: UI bindet sich auch dann, wenn die Daten-Initialisierung
    // (z. B. IndexedDB) auf einem Gerät klemmt – die App darf nie hängenbleiben.
    try {
      setupPhotoInputs();
      bindEvents();
      Vorpruefung.init();
      Behinderung.init();
      updateNetDot();
      initAppVersion();
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
      navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW-Registrierung fehlgeschlagen', e));
    }
  }

  // ----------------------------------------------------------- Übergabe (xlsx)
  async function handoverExport() {
    toast('Erzeuge Übergabe-Datei…');
    try {
      const name = await Handover.exportXlsx(currentJob);
      toast('Übergabe exportiert: ' + name);
    } catch (e) {
      console.error(e);
      toast('Übergabe-Export fehlgeschlagen: ' + (e.message || e));
    }
  }

  async function mergeContribution(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    toast('Führe Bilder zusammen…');
    try {
      const r = await Merge.importContributionZip(file);
      await renderTree();
      let msg = `${r.added} Bild(er) übernommen`;
      if (r.skipped) msg += `, ${r.skipped} bereits vorhanden`;
      if (r.addedNodes && r.addedNodes.length) msg += `, ${r.addedNodes.length} neue Position(en)`;
      toast(msg);
    } catch (err) {
      console.error(err);
      toast('Zusammenführen fehlgeschlagen: ' + (err.message || err));
    }
  }

  async function handoverImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    toast('Lese Übergabe-Datei…');
    try {
      const job = await Handover.importXlsx(file);
      currentJob = job;
      await DB.setCurrentJobId(job.id);
      catalogNames = null;
      show('view-start');
      await loadStartView();
      toast('Auftrag übernommen: ' + (job.name || ''));
    } catch (err) {
      console.error(err);
      toast('Import fehlgeschlagen: ' + (err.message || err));
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  // Öffentlich für andere Module:
  return { toast, openInfoModal, openFormModal, openConfirm, shareFile, show, getCurrentJob, saveCurrentJob };
})();
