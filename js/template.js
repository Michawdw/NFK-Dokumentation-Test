/* template.js – Import der Bilddoku-Struktur aus .xlsx (ExcelJS, nur Lesen)
   und Zusammenführung mit den im Feld angelegten eigenen Namen. */
const Structure = (() => {
  const SEP = '␟'; // Trennzeichen für stabile Knoten-Keys

  // ExcelJS wird erst bei Bedarf nachgeladen (nicht beim App-Start), damit der
  // Kaltstart auf alten Geräten nicht durch die ~950 KB große Datei blockiert.
  let _excelPromise = null;
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve();
    if (_excelPromise) return _excelPromise;
    _excelPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'lib/exceljs.min.js';
      s.onload = () => resolve();
      s.onerror = () => { _excelPromise = null; reject(new Error('ExcelJS konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
    return _excelPromise;
  }

  function makeKey(ober, unter, bildname) {
    return [ober, unter || '', bildname].join(SEP);
  }

  // Schlüssel eines Unterordners für die „nicht benötigt"-Markierung.
  function unterKey(ober, unter) {
    return ober + SEP + unter;
  }

  // Ist ein Knoten als „nicht benötigt" markiert? Hierarchisch: ein markierter
  // Ober-/Unterordner kaskadiert automatisch auf alle enthaltenen Bilder.
  function isSkipped(n, job) {
    const s = (job && job.skipped) || {};
    return (s.obers || []).includes(n.ober)
      || (!!n.unter && (s.unters || []).includes(unterKey(n.ober, n.unter)))
      || (s.nodes || []).includes(n.key);
  }

  function cellText(cell) {
    if (cell == null) return '';
    const v = (cell && cell.value != null) ? cell.value : cell;
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((r) => r.text).join('');
      if (v.text != null) return String(v.text);
      if (v.result != null) return String(v.result);
      return '';
    }
    return String(v);
  }

  // URL der mitgelieferten Vorlagen-Sammlung (jeder Tab = eine Vorlage).
  const CATALOG_URL = 'assets/templates.xlsx';

  // Liest ein importiertes Template (ArrayBuffer) -> Array von Knoten.
  // sheetName optional: bestimmtes Tab, sonst erstes Blatt.
  async function parseWorkbook(arrayBuffer, sheetName) {
    await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(arrayBuffer);
    const ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0];
    if (!ws) throw new Error('Vorlage/Tab nicht gefunden: ' + (sheetName || '(erstes Blatt)'));

    const nodes = [];
    let headerSeen = false;
    // „Fill-down": leere Ober-/Unterordner werden von der Zeile darüber fortgeführt
    // (wie zusammengefasste Excel-Zellen). Ein neuer Oberordner setzt den Unterordner zurück.
    let curOber = '';
    let curUnter = '';
    ws.eachRow({ includeEmpty: false }, (row) => {
      const ober = cellText(row.getCell(1)).trim();
      const unter = cellText(row.getCell(2)).trim();
      const bildname = cellText(row.getCell(3)).trim();
      const pflichtRaw = cellText(row.getCell(4)).trim();

      // Kopfzeile überspringen (erste Zeile, die "Oberordner"/"Bildname" enthält).
      if (!headerSeen) {
        const joined = (ober + unter + bildname).toLowerCase();
        if (joined.includes('oberordner') || joined.includes('bildname')) {
          headerSeen = true;
          return;
        }
        headerSeen = true; // falls keine erkennbare Kopfzeile: trotzdem ab jetzt Daten
      }

      // Fortführen/Aktualisieren der aktuellen Ordner.
      if (ober) { curOber = ober; curUnter = ''; } // neuer Oberordner -> Unterordner neu
      if (unter) { curUnter = unter; }

      if (!bildname) return; // reine Gruppenzeile / Leerzeile: nur Ordner merken

      const effOber = curOber || 'Allgemein';
      const effUnter = curUnter || null;

      let pflicht = parseInt(pflichtRaw, 10);
      if (!Number.isFinite(pflicht) || pflicht < 0) pflicht = 1;

      nodes.push({
        key: makeKey(effOber, effUnter, bildname),
        ober: effOber,
        unter: effUnter,
        bildname,
        pflicht,
        source: 'template',
      });
    });

    if (nodes.length === 0) throw new Error('Template enthält keine gültigen Zeilen.');
    return nodes;
  }

  // Importiert eine externe .xlsx-Datei (erstes Blatt). Markiert „Eigener Import".
  async function importFile(file) {
    const buf = await file.arrayBuffer();
    const nodes = await parseWorkbook(buf);
    const job = App.getCurrentJob();
    job.structure = nodes;
    job.selectedTemplate = EXTERNAL_LABEL;
    await App.saveCurrentJob();
    return nodes;
  }

  const EXTERNAL_LABEL = '(Eigener Import)';

  // Legt einen eigenen Namen/Bereich im aktuellen Auftrag an (bleibt bei Vorlagenwechsel erhalten).
  async function addCustomName(node) {
    const job = App.getCurrentJob();
    if (!job.customNames) job.customNames = [];
    if (!job.customNames.some((c) => c.key === node.key)) job.customNames.push(node);
    await App.saveCurrentJob();
  }

  // Lädt die Vorlagen-Sammlung als ArrayBuffer. Online: frisch vom Netz (neue Tabs
  // sichtbar); offline fällt der Service Worker auf die zwischengespeicherte Datei zurück.
  async function fetchCatalogBuffer() {
    const resp = await fetch(CATALOG_URL, { cache: 'no-store' });
    if (!resp.ok) throw new Error('Vorlagen-Datei nicht gefunden.');
    return resp.arrayBuffer();
  }

  // Liefert die Liste der verfügbaren Vorlagen (Tab-Namen aus templates.xlsx).
  async function listTemplates() {
    await loadExcelJS();
    const buf = await fetchCatalogBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return wb.worksheets.map((ws) => ws.name);
  }

  // Importiert eine Vorlage aus der Sammlung anhand des Tab-Namens.
  // Ersetzt nur die Struktur des Auftrags; eigene Namen bleiben erhalten.
  async function importFromCatalog(sheetName) {
    const buf = await fetchCatalogBuffer();
    const nodes = await parseWorkbook(buf, sheetName);
    const job = App.getCurrentJob();
    job.structure = nodes;
    job.selectedTemplate = sheetName;
    await App.saveCurrentJob();
    return nodes;
  }

  async function getSelectedTemplate() {
    const job = App.getCurrentJob();
    return (job && job.selectedTemplate) || null;
  }

  // Liefert die zusammengeführte, anzuzeigende Knotenliste: Vorlage ∪ eigene Namen
  // (aus dem aktuellen Auftrag).
  function getMerged() {
    const job = App.getCurrentJob();
    const tpl = (job && job.structure) || [];
    const custom = (job && job.customNames) || [];
    const map = new Map();
    for (const n of tpl) map.set(n.key, n);
    for (const c of custom) if (!map.has(c.key)) map.set(c.key, c); // eigene ergänzen, keine Doppel
    return Array.from(map.values());
  }

  // Gruppiert flache Knoten zu Ober -> (Unter|null) -> [Knoten] für die Anzeige.
  function groupForDisplay(nodes) {
    const obers = new Map(); // ober -> Map(unterKeyOrNull -> [nodes])
    for (const n of nodes) {
      if (!obers.has(n.ober)) obers.set(n.ober, new Map());
      const unterMap = obers.get(n.ober);
      const uk = n.unter || '';
      if (!unterMap.has(uk)) unterMap.set(uk, []);
      unterMap.get(uk).push(n);
    }
    return obers;
  }

  return {
    SEP, makeKey, unterKey, isSkipped, parseWorkbook, importFile, addCustomName, getMerged, groupForDisplay,
    listTemplates, importFromCatalog, getSelectedTemplate, EXTERNAL_LABEL, loadExcelJS,
  };
})();
