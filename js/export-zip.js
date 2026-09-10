/* export-zip.js – baut die Bilddoku-ZIP: Bilder in Template-Ordnerstruktur
   plus uebersicht.csv; Weitergabe via Android-Share, Fallback Download. */
const ExportZip = (() => {

  // Bereinigt einen Pfadteil (Ordner-/Dateiname) für ZIP-Einträge.
  function safePart(s) {
    return String(s || '')
      .replace(/[\\/:*?"<>|]/g, '_')   // unzulässige Zeichen
      .replace(/\s+$/g, '')            // Trailing-Whitespace
      .trim() || '_';
  }

  function csvCell(s) {
    const v = String(s == null ? '' : s);
    return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }

  async function build() {
    const nodes = await Structure.getMerged();
    if (nodes.length === 0) {
      App.toast('Keine Struktur vorhanden.');
      return;
    }
    const job = App.getCurrentJob();
    const enriched = await Overview.enrich(nodes);
    const project = (job && job.header) || {};

    // Filialnummer als Präfix der Bildnamen. Vorrang hat die vierstellige Nummer
    // (App.filialNr erkennt sie in jeder Schreibweise); nur wenn es keine gibt, greift
    // wie bisher die erste Ziffernfolge.
    const filNr = App.filialNr(project.filiale) || (String(project.filiale || '').match(/\d+/) || [])[0];
    const filPrefix = filNr ? filNr + '_' : '';

    const zip = new JSZip();

    // --- Index-CSV (UTF-8 BOM, ;-getrennt) ---
    const header = ['Oberordner', 'Unterordner', 'Bildname', 'Pflichtanzahl', 'Ist-Anzahl', 'Status'];
    const lines = [header.map(csvCell).join(';')];

    // manifest.json: maschinenlesbare Zuordnung Bild->Position (für exaktes Zusammenführen).
    const manifest = {
      app: 'nfk-doku', type: 'bilddoku', version: 1,
      job: { name: job && job.name, header: project },
      photos: [],
    };

    let totalPhotos = 0;
    for (const n of enriched) {
      lines.push([
        n.ober, n.unter || '', n.bildname, n.pflicht, n.ist,
        n.skipped ? 'nicht benötigt' : (n.done ? 'erledigt' : 'offen'),
      ].map(csvCell).join(';'));

      // --- Bilder in Ordnerstruktur ablegen ---
      const photos = await DB.getPhotos(job.id, n.key);
      const parts = [safePart(n.ober)];
      if (n.unter) parts.push(safePart(n.unter));
      const folder = parts.join('/');
      for (const p of photos) {
        const fname = `${filPrefix}${safePart(n.bildname)}_${String(p.seq).padStart(2, '0')}.jpg`;
        const path = `${folder}/${fname}`;
        zip.file(path, p.blob);
        manifest.photos.push({
          srcId: p.srcId || null,
          nodeKey: n.key,
          ober: n.ober, unter: n.unter || null, bildname: n.bildname, pflicht: n.pflicht,
          benoetigt: !n.skipped,
          seq: p.seq, createdAt: p.createdAt || null, path,
        });
        totalPhotos++;
      }
    }

    // --- Verwaiste Bilddoku-Bilder ---
    // Bilder, deren Position in der aktuellen Struktur nicht mehr existiert (z. B. nach
    // einem Vorlagenwechsel). Ohne Sonderbehandlung fielen sie stillschweigend aus dem
    // Export: die Backup-Erinnerung zählte sie, der Export ignorierte sie – „Jetzt sichern"
    // meldete dann „Noch keine Bilder aufgenommen" und die Warnung ließ sich nie ausräumen.
    // Fotoliste EINMAL lesen und weiterreichen: addOrphanPhotos und addBehinderungPhotos
    // holten sie sich bisher je selbst komplett neu.
    const allePhotos = await DB.getAllPhotos(job.id);
    totalPhotos += await addOrphanPhotos(zip, job, enriched, filPrefix, manifest, lines, allePhotos);

    const bilddokuPhotos = totalPhotos;

    // --- Bilder der Baubehinderungsanzeigen ---
    // Gehören zur lückenlosen Dokumentation, sind aber KEINE Bilddoku-Position. Daher:
    // eigener Ordner, eigener Manifest-Abschnitt und KEINE Zeile in uebersicht.csv –
    // sonst erschienen sie in der Übersicht als Position. Wichtig ist auch der eigene
    // Manifest-Schlüssel: merge.js legt aus manifest.photos fehlende Positionen als
    // eigene Namen an, was hier eine Phantom-Position „Baubehinderung" erzeugen würde.
    const behinderungPhotos = await addBehinderungPhotos(zip, job, filPrefix, manifest, allePhotos);
    totalPhotos += behinderungPhotos;

    zip.file('uebersicht.csv', '﻿' + lines.join('\r\n'));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Übergabe-Mappe mit in die ZIP: damit ist die ZIP ein vollständiges Übergabepaket
    // (Struktur, Zähler, „nicht benötigt", Kopfdaten + Bilder). Der Empfänger kann den
    // Auftrag daraus fortführen, ohne dass jemand vorher an „Übergabe export" denken muss.
    // Schlägt der Aufbau fehl (z. B. ExcelJS nicht ladbar), bleibt die ZIP trotzdem gültig –
    // die Bilder zu sichern ist wichtiger als die Beilage.
    try {
      zip.file(Handover.buildName(job), await Handover.buildWorkbookBuffer(job));
    } catch (e) {
      console.warn('Übergabe-Datei konnte der ZIP nicht beigelegt werden:', e);
    }

    if (totalPhotos === 0) {
      App.toast('Noch keine Bilder aufgenommen.');
      return;
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const fname = buildZipName(project);
    // geteilt = die Datei hat das Gerät verlassen. doBackupNow entscheidet daran, ob der
    // Auftrag als gesichert gilt (siehe App.shareFile).
    const geteilt = await App.shareFile(blob, fname, 'application/zip',
      `Bilddoku ${project.filiale || ''}`.trim());
    return { totalPhotos, bilddokuPhotos, behinderungPhotos, fname, geteilt };
  }

  // Legt Bilddoku-Bilder ab, deren Position es in der aktuellen Struktur nicht mehr gibt,
  // im Ordner „Ohne Zuordnung/<Ober>/[<Unter>/]". Sie bleiben damit gesichert und
  // wandern beim Zusammenführen über manifest.photos wieder an ihre ursprüngliche
  // Position zurück. Liefert die Anzahl der abgelegten Bilder.
  async function addOrphanPhotos(zip, job, enriched, filPrefix, manifest, lines, allePhotos) {
    const bekannt = new Set(enriched.map((n) => n.key));
    const byNode = new Map();
    for (const p of allePhotos) {
      if (!DB.isBilddokuPhoto(p)) continue;   // Vorprüfung/Behinderung: eigene Wege
      if (bekannt.has(p.nodeKey)) continue;   // regulär bereits exportiert
      if (!byNode.has(p.nodeKey)) byNode.set(p.nodeKey, []);
      byNode.get(p.nodeKey).push(p);
    }
    if (!byNode.size) return 0;

    let count = 0;
    for (const [key, photos] of byNode) {
      const teile = String(key).split(Structure.SEP);
      const ober = teile[0] || 'Allgemein';
      const unter = teile[1] || '';
      const bildname = teile[2] || key;
      const parts = ['Ohne Zuordnung', safePart(ober)];
      if (unter) parts.push(safePart(unter));
      const folder = parts.join('/');
      photos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

      lines.push([ober, unter, bildname, '', photos.length, 'nicht mehr in Vorlage']
        .map(csvCell).join(';'));

      for (const p of photos) {
        const fname = `${filPrefix}${safePart(bildname)}_${String(p.seq).padStart(2, '0')}.jpg`;
        const path = `${folder}/${fname}`;
        zip.file(path, p.blob);
        manifest.photos.push({
          srcId: p.srcId || null, nodeKey: key,
          ober, unter: unter || null, bildname, pflicht: 1, benoetigt: true, verwaist: true,
          seq: p.seq, createdAt: p.createdAt || null, path,
        });
        count++;
      }
    }
    return count;
  }

  // Legt die Fotos aller Baubehinderungsanzeigen im Ordner „Baubehinderung/<Datum>" ab.
  // Dateiname wie bei den übrigen Bildern, nur mit „Baubehinderung" als Bildnamen:
  //   <Filialnr>_Baubehinderung_<NN>.jpg
  // Mehrere Anzeigen am selben Tag bekommen „(2)", „(3)" … angehängt, damit sich die
  // Pfade nicht überschreiben. Liefert die Anzahl der abgelegten Bilder.
  async function addBehinderungPhotos(zip, job, filPrefix, manifest, allePhotos) {
    const NS = '__behinderung__';
    const all = allePhotos;
    const byNode = new Map();
    for (const p of all) {
      if (typeof p.nodeKey !== 'string' || p.nodeKey.indexOf(NS) !== 0) continue;
      if (!byNode.has(p.nodeKey)) byNode.set(p.nodeKey, []);
      byNode.get(p.nodeKey).push(p);
    }
    if (!byNode.size) return 0;

    // Reihenfolge über die Anzeigen selbst (älteste zuerst), damit die Ordner stabil sind;
    // Fotos ohne zugehörige Anzeige landen am Ende unter „ohne Zuordnung".
    const anzeigen = ((job && job.behinderungen) || []).slice()
      .sort((a, b) => String(a.datum || '').localeCompare(String(b.datum || ''))
        || (a.erstelltAm || 0) - (b.erstelltAm || 0));
    const reihenfolge = anzeigen.map((a) => ({ nodeKey: NS + a.id, datum: a.datum || '', id: a.id }));
    const bekannt = new Set(reihenfolge.map((r) => r.nodeKey));
    for (const nodeKey of byNode.keys()) {
      if (!bekannt.has(nodeKey)) reihenfolge.push({ nodeKey, datum: '', id: nodeKey.slice(NS.length) });
    }

    manifest.behinderung = [];
    const belegt = new Map(); // Ordnername -> wie oft schon vergeben
    let count = 0;
    for (const r of reihenfolge) {
      const photos = byNode.get(r.nodeKey);
      if (!photos || !photos.length) continue;
      photos.sort((a, b) => (a.seq || 0) - (b.seq || 0));

      let label = r.datum || 'ohne Zuordnung';
      const n = (belegt.get(label) || 0) + 1;
      belegt.set(label, n);
      if (n > 1) label += ' (' + n + ')';
      const folder = 'Baubehinderung/' + safePart(label);

      for (const p of photos) {
        const fname = `${filPrefix}Baubehinderung_${String(p.seq).padStart(2, '0')}.jpg`;
        const path = `${folder}/${fname}`;
        zip.file(path, p.blob);
        manifest.behinderung.push({
          srcId: p.srcId || null, anzeigeId: r.id, datum: r.datum || null,
          caption: p.caption || '', seq: p.seq, createdAt: p.createdAt || null, path,
        });
        count++;
      }
    }
    return count;
  }

  // Bilddoku_LI<Filialnummer>_<Ort>_Stand_<YYYY_MM_DD>.zip
  // (Filialnummer aus „7265 Memmingen" extrahiert, damit der Ort nicht doppelt erscheint).
  // „Stand" = Tag des Exports (nicht das Projekt-Datum): jede Sicherung ist vollständig
  // und eindeutig benannt – die neueste ersetzt alle älteren, die man löschen kann.
  function buildZipName(project) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const nr = App.filialNr(project.filiale) || (clean(project.filiale).match(/\d+/) || [])[0];
    const fil = (nr || clean(project.filiale) || 'Projekt').replace(/\s+/g, '_');
    const ort = clean(project.ort).replace(/\s+/g, '_');
    const d = Datum.fuerDatei();
    const parts = ['Bilddoku', 'LI' + fil];
    if (ort) parts.push(ort);
    parts.push('Stand', d);
    return parts.join('_').replace(/_+/g, '_') + '.zip';
  }

  return { build, safePart };
})();
