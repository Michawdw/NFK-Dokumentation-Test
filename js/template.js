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
    return parseSheet(wb, sheetName);
  }

  function parseSheet(wb, sheetName) {
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

  // Tauscht die Vorlage des Auftrags aus und nimmt alles mit, was an den alten Positionen
  // hängt. Nötig, weil der Schlüssel eines Bildes aus Ober␟Unter␟Bildname besteht: wird in
  // der Vorlage „Kassenzone" zu „01_Kassenzone", passte kein Schlüssel mehr. Die Bilder
  // wären zwar nicht verloren (der ZIP-Export legt sie unter „Ohne Zuordnung" ab), im Baum
  // aber unsichtbar – die Position stünde auf 0/1, obwohl das Foto existiert. Zugeordnet
  // wird mit denselben Regeln wie beim Zusammenführen (Merge.resolveNode): führende
  // Nummern-Präfixe, Umlaute und Trennzeichen spielen keine Rolle. Bilder ohne passende
  // neue Position bleiben als eigener Name „aus alter Vorlage" an ihrer alten Stelle.
  // Liefert { verschoben, positionen, offen, offenPrior } für die Rückmeldung an den Techniker;
  // offen = Bilder, die unter „aus alter Vorlage" weitergeführt werden.
  async function uebernehmeStruktur(job, nodes, label) {
    const alt = new Map(getMerged().map((n) => [n.key, n]));
    job.structure = nodes;
    job.selectedTemplate = label;
    // Fassung festhalten: daran erkennt die App später, ob eine neue Vorlage bereitsteht.
    job.templateStand = fingerprint(nodes);
    delete job.templateSpaeter;
    const bericht = await umzug(job, alt);
    await App.saveCurrentJob();
    return bericht;
  }

  // Zerlegt einen Schlüssel, dessen Knoten es nicht mehr gibt (z. B. Bilder aus einer
  // Vorlage, die schon vor diesem Wechsel ausgetauscht wurde).
  function nodeAusKey(key) {
    const t = String(key).split(SEP);
    return { nodeKey: key, ober: t[0] || '', unter: t[1] || null, bildname: t[2] || '' };
  }

  async function umzug(job, alt) {
    // Positionen „aus alter Vorlage" (siehe unten) bei jedem Wechsel neu bewerten: Passt
    // eine davon jetzt wieder zu einer Vorlagenposition, sollen ihre Bilder dorthin
    // umziehen, statt auf ewig im Ersatz-Namen zu hängen. Was weiter keinen Platz findet,
    // wird unten wieder als „aus alter Vorlage" angelegt.
    job.customNames = (job.customNames || []).filter((c) => c.source !== 'alt');
    const neu = getMerged();
    const bekannt = new Set(neu.map((n) => n.key));
    const index = Merge.buildNodeIndex(neu);
    // fremdCount entfällt: die alten Positionen sind die eigenen von eben, ein Bildname
    // kommt dort höchstens einmal vor.
    const ziel = (key) => {
      if (bekannt.has(key)) return null;                   // Position gibt es weiter
      const n = Merge.resolveNode(alt.get(key) || nodeAusKey(key), index, null);
      return n && n.key !== key ? n.key : null;
    };

    let verschoben = 0, offen = 0;
    const neuZuNummerieren = new Set();

    // 1) Bilder
    const proKey = new Map();
    for (const p of await DB.getBilddokuPhotos(job.id)) {
      if (!proKey.has(p.nodeKey)) proKey.set(p.nodeKey, []);
      proKey.get(p.nodeKey).push(p);
    }
    for (const [key, fotos] of proKey) {
      if (bekannt.has(key)) continue;
      const neuerKey = ziel(key);
      if (!neuerKey) {
        // Keine passende Position mehr: Die Bilder nicht unsichtbar werden lassen, sondern
        // an ihrer alten Stelle als eigenen Namen „aus alter Vorlage" weiterführen. So
        // bleiben sie im Baum, lassen sich ansehen, löschen und exportieren wie gewohnt.
        const n = alt.get(key) || nodeAusKey(key);
        job.customNames.push({
          key, ober: n.ober || 'Allgemein', unter: n.unter || null, bildname: n.bildname || key,
          // Nicht mehr gefordert: Pflicht höchstens so hoch wie die vorhandenen Bilder, damit
          // die Position als erledigt zählt und keine offenen Punkte vortäuscht.
          pflicht: Math.max(1, Math.min(n.pflicht || 1, fotos.length)),
          source: 'alt',
        });
        offen += fotos.length;
        continue;
      }
      for (const p of fotos) {
        p.nodeKey = neuerKey;
        await DB.updatePhoto(p);
      }
      verschoben += fotos.length;
      neuZuNummerieren.add(neuerKey);
    }

    // 2) Zähler des Vorteams. Ein Zähler ohne neue Position bleibt bewusst stehen: er
    //    wirkt nirgends mehr, lebt aber wieder auf, sobald die Position zurückkommt
    //    (z. B. nach einem Tippfehler in der Vorlage). Gemeldet wird er trotzdem.
    const prior = job.priorCounts || {};
    let offenPrior = 0;
    for (const key of Object.keys(prior)) {
      if (bekannt.has(key)) continue;
      const neuerKey = ziel(key);
      if (!neuerKey) { offenPrior += prior[key]; continue; }
      prior[neuerKey] = Math.max(prior[neuerKey] || 0, prior[key]);
      delete prior[key];
      neuZuNummerieren.add(neuerKey);
    }

    // 3) „nicht benötigt" – einzelne Positionen und ganze Ordner
    const s = job.skipped || {};
    if (s.nodes) s.nodes = s.nodes.map((k) => ziel(k) || k);
    const ordnerZiel = (alteNamen, neueNamen) => {
      const norm = new Map(neueNamen.map((n) => [Merge.normPart(n), n]));
      return (alteNamen || []).map((a) => (neueNamen.includes(a) ? a : (norm.get(Merge.normPart(a)) || a)));
    };
    if (s.obers) s.obers = ordnerZiel(s.obers, neu.map((n) => n.ober));
    if (s.unters) {
      s.unters = ordnerZiel(s.unters, neu.filter((n) => n.unter).map((n) => unterKey(n.ober, n.unter)));
    }

    // 4) Nummerierung der Zielpositionen lückenlos machen: dort treffen jetzt umgezogene
    //    und eventuell schon vorhandene Bilder aufeinander.
    for (const key of neuZuNummerieren) {
      await DB.renumberNode(job.id, key, prior[key] || 0);
    }
    const positionen = neuZuNummerieren.size;
    if (verschoben || offen || offenPrior) {
      console.info(`Vorlagenwechsel: ${verschoben} Bild(er) umgezogen, ${offen} ohne Zuordnung, `
        + `${offenPrior} Vorteam-Zähler ohne Zuordnung.`);
    }
    return { verschoben, positionen, offen, offenPrior };
  }

  // Importiert eine externe .xlsx-Datei (erstes Blatt). Markiert „Eigener Import".
  async function importFile(file) {
    const buf = await file.arrayBuffer();
    const nodes = await parseWorkbook(buf);
    const bericht = await uebernehmeStruktur(App.getCurrentJob(), nodes, EXTERNAL_LABEL);
    return { nodes, bericht };
  }

  const EXTERNAL_LABEL = '(Eigener Import)';
  // Struktur kam aus einer Übergabe-Datei/Bilddoku-ZIP, die keinen Vorlagennamen
  // mitliefert (alte ZIPs kennen nur die uebersicht.csv). Ohne eigenes Label stünde im
  // Dropdown weiter die vorherige Vorlage – der Baum zeigte dann etwas anderes als der Name.
  const HANDOVER_LABEL = '(Aus Übergabe)';

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

  // Geöffnete Vorlagen-Sammlung kurz vorhalten: Beim Betreten der Bilddoku braucht sie
  // die Namensliste, gleich danach die Prüfung auf eine neue Fassung und beim Übernehmen
  // noch einmal dieselbe Datei. Ohne diesen Puffer wäre das dreimal Laden und Parsen.
  let _katalog = null;   // { wb, zeit }
  const KATALOG_TTL = 120000;

  async function katalogWorkbook(frisch) {
    if (!frisch && _katalog && Date.now() - _katalog.zeit < KATALOG_TTL) return _katalog.wb;
    await loadExcelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await fetchCatalogBuffer());
    _katalog = { wb, zeit: Date.now() };
    return wb;
  }

  // Liefert die Liste der verfügbaren Vorlagen (Tab-Namen aus templates.xlsx).
  // frisch = true erzwingt das Neuladen der Datei (Knopf „↻ Vorlagen aktualisieren").
  async function listTemplates(frisch) {
    const wb = await katalogWorkbook(frisch);
    return wb.worksheets.map((ws) => ws.name);
  }

  // Kennung einer Vorlagen-Fassung: ändert sich, sobald eine Position dazukommt, wegfällt,
  // umbenannt wird oder eine andere Pflichtanzahl bekommt. Bewusst aus den Daten berechnet –
  // so muss in der Excel keine Versionsnummer gepflegt werden.
  function fingerprint(nodes) {
    const text = (nodes || []).map((n) => n.key + '|' + n.pflicht).sort().join('\n');
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
    return 'f' + h.toString(36) + '-' + (nodes || []).length;
  }

  // Gibt es für die Vorlage dieses Auftrags eine neue Fassung? Liefert null (nichts zu tun)
  // oder { name, nodes, stand, dazu, weg }.
  // Übersprungen wird: eigener Import, Struktur aus einem Paket („Aus Übergabe" oder ein
  // übernommener Auftrag – dort ist der Stand des Vorteams maßgeblich, nicht die Vorlage)
  // und eine Fassung, die der Techniker schon auf „Später" gesetzt hat.
  async function neueFassung(job) {
    const name = job && job.selectedTemplate;
    if (!name || name === EXTERNAL_LABEL || name === HANDOVER_LABEL) return null;
    const wb = await katalogWorkbook(false);
    if (!wb.getWorksheet(name)) return null;          // Vorlage umbenannt/entfernt
    const nodes = parseSheet(wb, name);
    const stand = fingerprint(nodes);
    if (job.templateStand === stand || job.templateSpaeter === stand) return null;
    if (!job.templateStand) {
      // Auftrag aus einer Zeit ohne gespeicherte Kennung. Stimmt seine Struktur mit der
      // Vorlage überein, nur die Kennung nachtragen – sonst käme ein Hinweis ohne Anlass.
      if (fingerprint(job.structure || []) === stand) {
        job.templateStand = stand;
        await App.saveCurrentJob();
        return null;
      }
      // Struktur aus einem fremden Paket: die darf eine Vorlage nicht überschreiben.
      if (job.uebernommen) return null;
    }
    const alt = new Set((job.structure || []).map((n) => n.key));
    const neuKeys = new Set(nodes.map((n) => n.key));
    return {
      name, nodes, stand,
      dazu: nodes.filter((n) => !alt.has(n.key)).length,
      weg: Array.from(alt).filter((k) => !neuKeys.has(k)).length,
    };
  }

  // „Jetzt übernehmen" aus dem Hinweis: identisch zum Wechsel über das Auswahlfeld.
  async function uebernehmeFassung(info) {
    const bericht = await uebernehmeStruktur(App.getCurrentJob(), info.nodes, info.name);
    return { nodes: info.nodes, bericht };   // gleiche Form wie importFromCatalog
  }

  // „Später": genau diese Fassung nicht mehr anbieten. Kommt eine neuere, meldet sich die
  // App wieder – die Kennung ist dann eine andere.
  async function spaeter(info) {
    const job = App.getCurrentJob();
    job.templateSpaeter = info.stand;
    await App.saveCurrentJob();
  }

  // Importiert eine Vorlage aus der Sammlung anhand des Tab-Namens.
  // Ersetzt nur die Struktur des Auftrags; eigene Namen bleiben erhalten.
  async function importFromCatalog(sheetName) {
    const nodes = parseSheet(await katalogWorkbook(false), sheetName);
    const bericht = await uebernehmeStruktur(App.getCurrentJob(), nodes, sheetName);
    return { nodes, bericht };
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
    for (const c of custom) {
      if (map.has(c.key)) continue; // von der Vorlage überlagert – dort gewinnt die Vorlage
      // Herkunft hier einmalig normalisieren, statt sie überall einzeln zu prüfen:
      // Alles, was in customNames steht, ist selbst angelegt ('custom'), beim
      // Zusammenführen übernommen ('merge') oder beim Vorlagenwechsel ohne neue Position
      // geblieben ('alt', siehe umzug). Ältere App-Versionen könnten das Feld gar
      // nicht oder abweichend gesetzt haben – dann gilt 'custom'. Nur so bekommen auch
      // Altbestände aus laufenden Aufträgen ihr Abzeichen und ihren Löschknopf.
      map.set(c.key, (c.source === 'custom' || c.source === 'merge' || c.source === 'alt')
        ? c
        : Object.assign({}, c, { source: 'custom' }));
    }
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
    uebernehmeStruktur, neueFassung, uebernehmeFassung, spaeter,
    listTemplates, importFromCatalog, getSelectedTemplate, EXTERNAL_LABEL, HANDOVER_LABEL, loadExcelJS,
  };
})();
