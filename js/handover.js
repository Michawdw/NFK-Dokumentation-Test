/* handover.js – Übergabe/Zwischenstand als eine Excel-Datei (.xlsx).
   Zweck: ein anderes Team importiert die Datei und sieht den exakten Stand
   (erledigte/offene Pflichtbilder); die Foto-Nummerierung läuft weiter (keine Doppel).
   Dieselbe Datei kann der Innendienst öffnen und auswerten.
   Über den Knopf „Übergabe export" werden KEINE Bilder übertragen – nur Status/Zähler.

   Blatt „Auftrag":   Kopf-Felder (Feld | Wert) für den Re-Import.
   Blatt „Uebersicht": Oberordner | Unterordner | Bildname | Pflichtanzahl | Ist-Anzahl | Status

   Dieselbe Mappe legt export-zip.js zusätzlich IN die Bilddoku-ZIP (buildWorkbookBuffer),
   damit die ZIP ein vollständiges Übergabepaket ist: Struktur + Status + Bilder. Der
   ZIP-Import in merge.js liest sie über readFromZip() wieder aus – ersatzweise aus der
   uebersicht.csv älterer ZIPs, die dieselben sechs Spalten enthält. */
const Handover = (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function cellText(cell) {
    const v = cell ? cell.value : null;
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((r) => r.text).join('');
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      return '';
    }
    return String(v);
  }

  function mergedOf(job) {
    const map = new Map();
    for (const n of (job.structure || [])) map.set(n.key, n);
    for (const c of (job.customNames || [])) if (!map.has(c.key)) map.set(c.key, c);
    return Array.from(map.values());
  }

  async function enrichForJob(job, nodes) {
    const counts = await DB.countPhotosByNode(job.id);   // eine Abfrage statt einer je Position
    return nodes.map((n) => {
      const prior = (job.priorCounts && job.priorCounts[n.key]) || 0;
      const ist = prior + (counts.get(n.key) || 0);
      return { n, ist, done: ist >= n.pflicht, skipped: Structure.isSkipped(n, job) };
    });
  }

  function buildName(job) {
    const h = job.header || {};
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const nr = App.filialNr(h.filiale) || (clean(h.filiale).match(/\d+/) || [])[0];
    const fil = (nr || clean(h.filiale)).replace(/\s+/g, '_');
    const ort = clean(h.ort).replace(/\s+/g, '_');
    const d = Datum.fuerDatei(h.datum);
    return ['Uebergabe', 'LI' + fil, ort, d].filter(Boolean).join('_').replace(/_+/g, '_') + '.xlsx';
  }

  // Baut die Übergabe-Mappe und liefert sie als Buffer. Getrennt vom Teilen, damit
  // export-zip.js dieselbe Datei in die ZIP legen kann, ohne sie zu verschicken.
  async function buildWorkbookBuffer(job) {
    await Structure.loadExcelJS();
    const nodes = mergedOf(job);
    const enriched = await enrichForJob(job, nodes);
    const h = job.header || {};
    const skip = job.skipped || {};

    const wb = new ExcelJS.Workbook();

    const s1 = wb.addWorksheet('Auftrag');
    s1.columns = [{ width: 18 }, { width: 40 }];
    s1.addRow(['Feld', 'Wert']);
    s1.getRow(1).font = { bold: true };
    s1.addRow(['id', job.id]);
    s1.addRow(['name', job.name || '']);
    s1.addRow(['filiale', h.filiale || '']);
    s1.addRow(['ort', h.ort || '']);
    s1.addRow(['datum', h.datum || '']);
    s1.addRow(['beauftragung', h.beauftragung || 'NFK Vollverkabelung']);
    s1.addRow(['techniker', (h.techniker || []).join(', ')]);
    s1.addRow(['vorlage', job.selectedTemplate || '']);
    // Ganze Ordner auf „nicht benötigt": als JSON, weil Ordnernamen Kommas enthalten
    // dürfen. Ohne diese beiden Zeilen ließen sich nur einzelne Positionen zurückholen –
    // der Ordner-Knopf im Baum stünde beim Empfänger wieder auf „benötigt".
    // Vorprüfung mitgeben: Ohne sie sperrt goGuard den Empfänger nach dem Import aus
    // Bilddoku UND Bautagebuch aus, bis er alle Punkte erneut beantwortet – obwohl die
    // Baustelle längst geprüft ist. Die Baubehinderungsanzeigen bleiben dagegen bewusst
    // beim Ersteller: sie sind rechtsverbindliche Schreiben mit eigenem Absender; ihre
    // Fotos liegen für den Innendienst im ZIP-Ordner „Baubehinderung/".
    s1.addRow(['vorpruefung', JSON.stringify(job.vorpruefung || null)]);
    s1.addRow(['skippedObers', JSON.stringify(skip.obers || [])]);
    s1.addRow(['skippedUnters', JSON.stringify((skip.unters || []).map((k) => {
      const i = String(k).indexOf(Structure.SEP);
      return i < 0 ? [String(k), ''] : [String(k).slice(0, i), String(k).slice(i + 1)];
    }))]);

    const s2 = wb.addWorksheet('Uebersicht');
    s2.columns = [{ width: 20 }, { width: 18 }, { width: 26 }, { width: 12 }, { width: 11 }, { width: 11 }];
    s2.addRow(['Oberordner', 'Unterordner', 'Bildname', 'Pflichtanzahl', 'Ist-Anzahl', 'Status']);
    s2.getRow(1).font = { bold: true };
    for (const e of enriched) {
      s2.addRow([e.n.ober, e.n.unter || '', e.n.bildname, e.n.pflicht, e.ist,
        e.skipped ? 'nicht benötigt' : (e.done ? 'erledigt' : 'offen')]);
    }
    s2.autoFilter = 'A1:F1';
    s2.views = [{ state: 'frozen', ySplit: 1 }];

    return wb.xlsx.writeBuffer();
  }

  async function exportXlsx(job) {
    const buf = await buildWorkbookBuffer(job);
    const blob = new Blob([buf], { type: MIME });
    const name = buildName(job);
    await App.shareFile(blob, name, MIME, 'Übergabe ' + ((job.header || {}).filiale || ''));
    return name;
  }

  // ------------------------------------------------------------------ Einlesen
  // Alle Quellen (Excel-Blatt, uebersicht.csv) werden auf dieselbe Zeilenform gebracht:
  // { ober, unter, bildname, pflicht, ist, status }. applyHandoverData() kennt nur diese.

  function toRow(ober, unter, bildname, pflichtRaw, istRaw, statusRaw) {
    if (!bildname) return null;
    let pflicht = parseInt(pflichtRaw, 10); if (!Number.isFinite(pflicht) || pflicht < 0) pflicht = 1;
    let ist = parseInt(istRaw, 10); if (!Number.isFinite(ist) || ist < 0) ist = 0;
    return {
      ober: ober || 'Allgemein', unter: unter || null, bildname,
      pflicht, ist, status: String(statusRaw || '').toLowerCase(),
      // Leere Pflichtanzahl kommt nur aus der uebersicht.csv-Zeile „nicht mehr in Vorlage"
      // (verwaiste Bilder). Solche Positionen gehören nicht in die Vorlage, sondern als
      // eigener Name in den Auftrag – sonst wüchse die Vorlage bei jedem Import.
      fremd: String(statusRaw || '').toLowerCase().includes('nicht mehr in vorlage'),
    };
  }

  function isHeaderRow(ober, unter, bildname) {
    const joined = (ober + unter + bildname).toLowerCase();
    return joined.includes('oberordner') || joined.includes('bildname');
  }

  function rowsFromSheet(ws) {
    const rows = [];
    let headerSeen = false;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const ober = cellText(row.getCell(1)).trim();
      const unter = cellText(row.getCell(2)).trim();
      const bildname = cellText(row.getCell(3)).trim();
      if (!headerSeen) {
        headerSeen = true;
        if (isHeaderRow(ober, unter, bildname)) return;
      }
      const r = toRow(ober, unter, bildname,
        cellText(row.getCell(4)).trim(), cellText(row.getCell(5)).trim(),
        cellText(row.getCell(6)).trim());
      if (r) rows.push(r);
    });
    return rows;
  }

  function kvFromSheet(ws) {
    const kv = {};
    if (!ws) return kv;
    ws.eachRow((row, idx) => {
      if (idx === 1) return; // Kopf
      const k = cellText(row.getCell(1)).trim().toLowerCase();
      if (k) kv[k] = cellText(row.getCell(2)).trim();
    });
    return kv;
  }

  // CSV wie von export-zip.js geschrieben: UTF-8 mit BOM, „;"-getrennt, ""-Quoting, CRLF.
  function parseCsv(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quoted) {
        if (c === '"') {
          if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
        } else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function rowsFromCsv(text) {
    const out = [];
    let headerSeen = false;
    for (const r of parseCsv(text)) {
      const ober = (r[0] || '').trim();
      const unter = (r[1] || '').trim();
      const bildname = (r[2] || '').trim();
      if (!headerSeen) {
        headerSeen = true;
        if (isHeaderRow(ober, unter, bildname)) continue;
      }
      const row = toRow(ober, unter, bildname, (r[3] || '').trim(), (r[4] || '').trim(), (r[5] || '').trim());
      if (row) out.push(row);
    }
    return out;
  }

  function readFromWorkbook(wb) {
    const s2 = wb.getWorksheet('Uebersicht');
    if (!s2) return null;
    return { kv: kvFromSheet(wb.getWorksheet('Auftrag')), rows: rowsFromSheet(s2) };
  }

  // Liest den Übergabestand aus einer bereits geöffneten Bilddoku-ZIP.
  // Reihenfolge: beigelegte Übergabe-.xlsx (neue ZIPs) -> uebersicht.csv (alte ZIPs).
  // Kopfdaten, die der CSV fehlen, kommen aus manifest.json. Liefert null, wenn die ZIP
  // keine dieser Quellen enthält.
  async function readFromZip(zip) {
    let out = null;

    // Über zip.filter statt zip.files: so funktioniert das auch, wenn merge.js einen
    // Wurzelordner weggekürzt hat (neu gepackte ZIP) – zip ist dann eine Ordner-Sicht.
    const mappen = zip.filter((rel, f) => !f.dir && /^[^/]+\.xlsx$/i.test(rel))
      .sort((a, b) => a.name < b.name ? -1 : 1);
    if (mappen.length) {
      try {
        await Structure.loadExcelJS();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await mappen[0].async('arraybuffer'));
        out = readFromWorkbook(wb);
      } catch (e) { console.warn('Übergabe-Excel in der ZIP unlesbar:', e); }
    }

    if (!out) {
      const csv = zip.file('uebersicht.csv');
      if (csv) {
        const rows = rowsFromCsv(await csv.async('string'));
        if (rows.length) out = { kv: {}, rows };
      }
    }
    if (!out) return null;

    // Kopfdaten aus manifest.json ergänzen (nur was noch fehlt) – die CSV kennt sie nicht.
    const mf = zip.file('manifest.json');
    if (mf) {
      try {
        const data = JSON.parse(await mf.async('string'));
        const h = (data && data.job && data.job.header) || {};
        const kv = out.kv;
        if (!kv.name && data && data.job && data.job.name) kv.name = String(data.job.name);
        for (const [feld, wert] of [['filiale', h.filiale], ['ort', h.ort], ['datum', h.datum],
          ['beauftragung', h.beauftragung]]) {
          if (!kv[feld] && wert) kv[feld] = String(wert);
        }
        if (!kv.techniker && Array.isArray(h.techniker)) kv.techniker = h.techniker.join(', ');
      } catch (e) { console.warn('manifest.json unlesbar:', e); }
    }
    return out;
  }

  function parseJsonArray(s) {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }

  // Vorprüfung des Vorteams übernehmen – aber nur, wenn hier noch keine eigene beantwortet
  // wurde: eine bereits ausgefüllte Vorprüfung darf ein Import nie überschreiben.
  // Ohne diesen Schritt bliebe der Empfänger durch goGuard aus Bilddoku und Bautagebuch
  // ausgesperrt und müsste eine längst laufende Baustelle noch einmal prüfen.
  function uebernehmeVorpruefung(kv, job) {
    if (!kv || !kv.vorpruefung) return;
    if (job.vorpruefung && !Vorpruefung.isIncomplete(job)) return;
    try {
      const v = JSON.parse(kv.vorpruefung);
      if (v && v.items) job.vorpruefung = v;
    } catch (e) { console.warn('Vorprüfung aus der Übergabe unlesbar:', e); }
  }

  // Baut aus den eingelesenen Zeilen Struktur, Zähler und „nicht benötigt"-Marken und
  // schreibt sie in einen Auftrag.
  //   opts.job       vorhandenen Auftrag aktualisieren (sonst: über kv.id suchen / neu anlegen)
  //   opts.soft      eigene Kopfdaten und eigene Skip-Marken NICHT überschreiben, nur ergänzen.
  //                  Wird beim ZIP-Import benutzt: dort übernimmt man die Struktur des
  //                  Kollegen, aber nicht dessen Projektkopf über den eigenen.
  //   opts.nurStatus nur Zähler und „nicht benötigt" übernehmen, Struktur/Vorlage/Kopf
  //                  unangetastet lassen. Der Fall „gleiche Vorlage": die Struktur muss
  //                  gar nicht ersetzt werden, der Stand des Kollegen soll aber trotzdem
  //                  ankommen – sonst hinge die Fortführbarkeit daran, ob die Vorlagen
  //                  zufällig auseinanderlaufen.
  //   opts.mapKey    (row) => eigener Schlüssel oder null. Übersetzt die Positionen des
  //                  Kollegen auf die eigenen (siehe resolveNode in merge.js).
  async function applyHandoverData(kv, rows, opts) {
    const o = opts || {};
    if (!rows || rows.length === 0) throw new Error('Übergabe-Daten enthalten keine Positionen.');
    const istSkip = (r) => r.status.includes('nicht benötigt') || r.status.includes('nicht benoetigt');

    if (o.nurStatus) {
      const job = o.job;
      if (!job) throw new Error('nurStatus braucht einen Auftrag.');
      if (!job.priorCounts) job.priorCounts = {};
      const skipNodes = [];
      for (const r of rows) {
        const key = o.mapKey ? o.mapKey(r) : Structure.makeKey(r.ober, r.unter, r.bildname);
        if (!key) continue; // Position gibt es hier nicht – kein toter Zähler-Eintrag
        // Nur echte Zähler speichern: sonst stünden nach jedem Import mehrere hundert
        // Nullwerte im Auftrag (bei 370 Positionen gut 20 KB, die bei jedem Speichern
        // mitgeschrieben werden) – ohne jede Wirkung, denn 0 ist der Standard.
        const wert = Math.max(r.ist, job.priorCounts[key] || 0);
        if (wert > 0) job.priorCounts[key] = wert; else delete job.priorCounts[key];
        if (istSkip(r)) skipNodes.push(key);
      }
      const alt = job.skipped || {};
      const vereinen = (a, b) => Array.from(new Set([].concat(a || [], b || [])));
      job.skipped = {
        // Ordner-Marken greifen nur bei identischen Ordnernamen; die Einzelmarken oben
        // decken denselben Stand ohnehin ab, sie sind hier also reine Zugabe.
        obers: vereinen(alt.obers, parseJsonArray(kv.skippedobers)),
        unters: vereinen(alt.unters, parseJsonArray(kv.skippedunters)
          .map((p) => Array.isArray(p) ? Structure.unterKey(p[0], p[1]) : String(p))),
        nodes: vereinen(alt.nodes, skipNodes),
      };
      // Auch auf diesem Weg: Wer die ZIP des Vorteams über „Beiträge zusammenführen"
      // einliest, statt über „Übergabe import", landet bei gleicher Vorlage hier – und
      // wäre sonst als Einziger ohne Vorprüfung und damit gesperrt.
      uebernehmeVorpruefung(kv, job);
      await DB.saveJob(job);
      return { job, neu: false, positionen: rows.length };
    }

    const structure = [];
    const fremdNodes = [];
    const priorCounts = {};
    const skippedNodes = [];
    for (const r of rows) {
      const key = Structure.makeKey(r.ober, r.unter, r.bildname);
      const node = { key, ober: r.ober, unter: r.unter, bildname: r.bildname, pflicht: r.pflicht };
      if (r.fremd) fremdNodes.push(Object.assign(node, { source: 'merge' }));
      else structure.push(Object.assign(node, { source: 'template' }));
      if (r.ist > 0) priorCounts[key] = r.ist; // Nullwerte wären wirkungslose Altlast
      if (istSkip(r)) skippedNodes.push(key);
    }
    if (structure.length === 0) throw new Error('Übergabe-Daten enthalten keine Positionen.');

    let job = o.job || (kv.id ? await DB.getJob(kv.id) : null);
    const neu = !job;
    if (!job) {
      job = DB.newJob(kv.name || kv.filiale || 'Übernommener Auftrag');
      if (kv.id) job.id = kv.id;
    }

    const hAlt = job.header || {};
    if (o.soft) {
      // Der ZIP-Import fasst den Projektkopf NICHT an: welche Stammdaten aus dem Paket
      // übernommen werden, entscheidet der Nutzer vorher Feld für Feld in der
      // Gegenüberstellung (siehe merge.js). Nur ein leerer Name wird ergänzt.
      job.header = hAlt;
      if (!job.name) job.name = kv.name || job.name;
    } else {
      job.name = kv.name || job.name;
      job.header = {
        filiale: kv.filiale || '',
        ort: kv.ort || '',
        datum: kv.datum || '',
        beauftragung: kv.beauftragung || 'NFK Vollverkabelung',
        techniker: (kv.techniker || '').split(',').map((t) => t.trim()).filter(Boolean),
      };
    }

    job.structure = structure;
    job.customNames = job.customNames || [];
    for (const f of fremdNodes) {
      if (!job.customNames.some((c) => c.key === f.key)) job.customNames.push(f);
    }

    // Zähler: beim harten Import (Übergabe-Datei) ersetzen, beim weichen (ZIP) den
    // höheren Stand behalten – der eigene Zähler darf nicht kleiner werden.
    if (o.soft) {
      const alt = job.priorCounts || {};
      const zusammen = Object.assign({}, alt);
      for (const k of Object.keys(priorCounts)) {
        zusammen[k] = Math.max(priorCounts[k], alt[k] || 0);
      }
      job.priorCounts = zusammen;
    } else {
      job.priorCounts = priorCounts;
      // Bereits vorhandene Bilder gegenrechnen: landet die Übergabe-Datei in einem
      // Auftrag, den es hier schon gibt (gleiche id), stecken dessen Bilder in der
      // Ist-Anzahl des Absenders bereits drin. Ohne Abzug stünde 4/1 statt 2/1.
      // Nur im harten Pfad: beim ZIP-Import (soft) verrechnet merge.js gezielt die
      // Positionen, für die tatsächlich Bilder mitgeliefert wurden.
      if (!neu) {
        const lokal = new Map();
        for (const p of await DB.getBilddokuPhotos(job.id)) {
          lokal.set(p.nodeKey, (lokal.get(p.nodeKey) || 0) + 1);
        }
        for (const [key, anzahl] of lokal) {
          const prior = Math.max(0, (job.priorCounts[key] || 0) - anzahl);
          if (prior > 0) job.priorCounts[key] = prior; else delete job.priorCounts[key];
          await DB.renumberNode(job.id, key, prior); // lückenlos: prior+1 … prior+n
        }
      }
    }

    const obersAusKv = parseJsonArray(kv.skippedobers);
    const untersAusKv = parseJsonArray(kv.skippedunters)
      .map((p) => Array.isArray(p) ? Structure.unterKey(p[0], p[1]) : String(p));
    const altSkip = (o.soft && job.skipped) ? job.skipped : {};
    const vereinen = (a, b) => Array.from(new Set([].concat(a || [], b || [])));
    job.skipped = {
      obers: vereinen(altSkip.obers, obersAusKv),
      unters: vereinen(altSkip.unters, untersAusKv),
      nodes: vereinen(altSkip.nodes, skippedNodes),
    };

    uebernehmeVorpruefung(kv, job);

    // Die bisherige Angabe ist nach dem Strukturaustausch in jedem Fall überholt.
    job.selectedTemplate = kv.vorlage || Structure.HANDOVER_LABEL;

    await DB.saveJob(job);
    return { job, neu, positionen: structure.length };
  }

  // Liest eine Übergabe-Datei und legt daraus einen Auftrag an / aktualisiert ihn.
  //   opts.pruefen  (paket, zielAuftrag, info) => null (abbrechen) | { kopfFelder }
  //                 Wird vor jedem Schreibzugriff aufgerufen (wie beim ZIP-Import).
  async function importXlsx(file, opts) {
    const o = opts || {};
    await Structure.loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());

    const daten = readFromWorkbook(wb);
    if (!daten) throw new Error('Blatt „Uebersicht" fehlt – keine gültige Übergabe-Datei.');

    if (o.pruefen) {
      // Zielauftrag ist der Auftrag gleicher id – nur dessen Kopf wird überschrieben. Gibt es
      // ihn hier nicht, entsteht ein NEUER Auftrag; dann kann nichts vermischt werden, die
      // Filialnummer wird aber trotzdem gegen den offenen Auftrag geprüft, damit ein
      // versehentlich gewähltes Paket auffällt.
      const bestehend = daten.kv.id ? await DB.getJob(daten.kv.id) : null;
      const antwort = await o.pruefen(
        { filiale: daten.kv.filiale || '', ort: daten.kv.ort || '', filialNr: App.filialNr(daten.kv.filiale) },
        bestehend || App.getCurrentJob() || null,
        { neu: !bestehend });
      if (!antwort) return null; // abgebrochen – es wurde nichts geschrieben
    }

    const r = await applyHandoverData(daten.kv, daten.rows);
    return r.job;
  }

  return {
    exportXlsx, importXlsx, buildName,
    buildWorkbookBuffer, readFromZip, applyHandoverData,
  };
})();
