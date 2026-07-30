/* handover.js – Übergabe/Zwischenstand als eine Excel-Datei (.xlsx).
   Zweck: ein anderes Team importiert die Datei und sieht den exakten Stand
   (erledigte/offene Pflichtbilder); die Foto-Nummerierung läuft weiter (keine Doppel).
   Dieselbe Datei kann der Innendienst öffnen und auswerten.
   Es werden KEINE Bilder übertragen – nur Status/Zähler.

   Blatt „Auftrag":   Kopf-Felder (Feld | Wert) für den Re-Import.
   Blatt „Uebersicht": Oberordner | Unterordner | Bildname | Pflichtanzahl | Ist-Anzahl | Status
*/
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
    const counts = await Promise.all(nodes.map((n) => DB.countPhotos(job.id, n.key)));
    return nodes.map((n, i) => {
      const prior = (job.priorCounts && job.priorCounts[n.key]) || 0;
      const ist = prior + counts[i];
      return { n, ist, done: ist >= n.pflicht, skipped: Structure.isSkipped(n, job) };
    });
  }

  function buildName(job) {
    const h = job.header || {};
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const numMatch = clean(h.filiale).match(/\d+/);
    const fil = (numMatch ? numMatch[0] : clean(h.filiale)).replace(/\s+/g, '_');
    const ort = clean(h.ort).replace(/\s+/g, '_');
    const d = (h.datum || new Date().toISOString().slice(0, 10)).replace(/-/g, '_');
    return ['Uebersicht', 'LI' + fil, ort, d].filter(Boolean).join('_').replace(/_+/g, '_') + '.xlsx';
  }

  async function exportXlsx(job) {
    await Structure.loadExcelJS();
    const nodes = mergedOf(job);
    const enriched = await enrichForJob(job, nodes);
    const h = job.header || {};

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

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: MIME });
    const name = buildName(job);
    await App.shareFile(blob, name, MIME, 'Übergabe ' + (h.filiale || ''));
    return name;
  }

  // Liest eine Übergabe-Datei und legt daraus einen Auftrag an / aktualisiert ihn.
  async function importXlsx(file) {
    await Structure.loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());

    const s1 = wb.getWorksheet('Auftrag');
    const kv = {};
    if (s1) {
      s1.eachRow((row, idx) => {
        if (idx === 1) return; // Kopf
        const k = cellText(row.getCell(1)).trim().toLowerCase();
        if (k) kv[k] = cellText(row.getCell(2)).trim();
      });
    }

    const s2 = wb.getWorksheet('Uebersicht');
    if (!s2) throw new Error('Blatt „Uebersicht" fehlt – keine gültige Übergabe-Datei.');

    const structure = [];
    const priorCounts = {};
    const skippedNodes = [];
    let headerSeen = false;
    s2.eachRow({ includeEmpty: false }, (row) => {
      const ober = cellText(row.getCell(1)).trim();
      const unter = cellText(row.getCell(2)).trim();
      const bildname = cellText(row.getCell(3)).trim();
      const pflichtRaw = cellText(row.getCell(4)).trim();
      const istRaw = cellText(row.getCell(5)).trim();
      const statusRaw = cellText(row.getCell(6)).trim().toLowerCase();

      if (!headerSeen) { // Kopfzeile überspringen
        headerSeen = true;
        if ((ober + bildname).toLowerCase().includes('oberordner') ||
            (ober + bildname).toLowerCase().includes('bildname')) return;
      }
      if (!bildname) return;

      let pflicht = parseInt(pflichtRaw, 10); if (!Number.isFinite(pflicht) || pflicht < 0) pflicht = 1;
      let ist = parseInt(istRaw, 10); if (!Number.isFinite(ist) || ist < 0) ist = 0;

      const key = Structure.makeKey(ober || 'Allgemein', unter || null, bildname);
      structure.push({ key, ober: ober || 'Allgemein', unter: unter || null, bildname, pflicht, source: 'template' });
      priorCounts[key] = ist;
      // „nicht benötigt"-Status rekonstruieren (pro Position; Ordner-Skips materialisieren
      // sich als Summe ihrer Kind-Keys – gleiches Endergebnis).
      if (statusRaw.includes('nicht benötigt') || statusRaw.includes('nicht benoetigt')) skippedNodes.push(key);
    });

    if (structure.length === 0) throw new Error('Übergabe-Datei enthält keine Positionen.');

    // Vorhandenen Auftrag gleicher id aktualisieren, sonst neuen anlegen.
    let job = kv.id ? await DB.getJob(kv.id) : null;
    if (!job) {
      job = DB.newJob(kv.name || kv.filiale || 'Übernommener Auftrag');
      if (kv.id) job.id = kv.id;
    }
    job.name = kv.name || job.name;
    job.header = {
      filiale: kv.filiale || '', ort: kv.ort || '', datum: kv.datum || '',
      beauftragung: kv.beauftragung || 'NFK Vollverkabelung',
      techniker: (kv.techniker || '').split(',').map((t) => t.trim()).filter(Boolean),
    };
    job.structure = structure;
    job.customNames = job.customNames || [];
    job.priorCounts = priorCounts;
    job.skipped = { obers: [], unters: [], nodes: skippedNodes };
    job.selectedTemplate = kv.vorlage || job.selectedTemplate || null;

    await DB.saveJob(job);
    return job;
  }

  return { exportXlsx, importXlsx, buildName };
})();
