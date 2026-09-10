/* bautagebuch.js – erzeugt das Bautagebuch als .xlsx.
   Methode: ZIP-Patch der Originalvorlage (assets/vorlage_bautagebuch.xlsx).
   Es wird ausschließlich xl/worksheets/sheet1.xml angepasst – nur die Wertzellen.
   Styles, Rahmen, Schriften, eingebettetes Logo, Druckbereich und Blattschutz
   bleiben dadurch garantiert 1:1 erhalten (Anf. D / „Optik verbindlich").

   Verwendete Werttypen:
   - Datum  -> echte Excel-Seriennummer (Zellstil hält das Datumsformat)
   - Zeiten -> Tagesbruchteil (07:00 = 0.2916…); Zellstil hält hh:mm
   - Texte  -> inline strings (sharedStrings bleibt unangetastet)
*/
const Bautagebuch = (() => {
  const TEMPLATE_URL = 'assets/vorlage_bautagebuch.xlsx';
  const SHEET_PATH = 'xl/worksheets/sheet1.xml';
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const MAX_ROWS = 5; // Techniker-Zeilen 8..12

  // ---- Hilfsfunktionen ----
  // Docx.xmlSauber entfernt Zeichen, die XML 1.0 nicht zulässt (z. B. U+000B aus einem
  // Shift+Enter in Word). Ohne diesen Schritt öffnet Excel die fertige Datei nicht mehr:
  // „Die Datei ist beschädigt". Die Funktion liegt in docx.js, weil beide Erzeuger sie
  // brauchen – dort steht auch die ausführliche Begründung.
  function escapeXml(s) {
    return Docx.xmlSauber(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Excel-Seriennummer aus 'YYYY-MM-DD' (1900-Datumssystem inkl. Schaltjahr-Bug-Offset).
  function excelSerial(dateStr) {
    if (!dateStr) return null;
    const [y, mo, d] = dateStr.split('-').map(Number);
    const utc = Date.UTC(y, mo - 1, d);
    const epoch = Date.UTC(1899, 11, 30);
    return Math.round((utc - epoch) / 86400000);
  }

  // 'HH:MM' -> Tagesbruchteil (oder null bei leer/ungültig).
  function timeFraction(str) {
    if (!str) return null;
    const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h > 48 || min > 59) return null;
    return (h * 60 + min) / 1440;
  }

  // Ersetzt eine Zelle in der sheet-XML, behält den vorhandenen Stil (s="…") bei.
  // build() liefert { t?:string, inner:string } oder null für „leere Zelle".
  function setCell(xml, ref, build, fehlend) {
    const re = new RegExp('<c r="' + ref + '"([^>]*?)(?:/>|>[\\s\\S]*?</c>)');
    if (!re.test(xml)) {
      // Bis v38 verschwand der Wert hier lautlos – der Techniker bekam ein unvollständiges
      // Bautagebuch, ohne einen Hinweis zu sehen. Gemeldet wird nur, wenn dabei ein ECHTER
      // Wert verlorengeht; ungenutzte Technikerzeilen lösen keinen Alarm aus.
      // Hinweis für neue Vorlagen: Excel schreibt stilfreie Leerzellen gar nicht ins XML –
      // jede Zielzelle muss also formatiert sein, sonst fehlt sie hier.
      if (fehlend && build()) fehlend.push(ref);
      console.warn('Zelle nicht gefunden:', ref);
      return xml;
    }
    return xml.replace(re, (m, attrs) => {
      const sm = attrs.match(/\bs="(\d+)"/);
      const sAttr = sm ? ' s="' + sm[1] + '"' : '';
      const built = build();
      if (!built) return `<c r="${ref}"${sAttr}/>`; // leeren
      const tAttr = built.t ? ` t="${built.t}"` : '';
      return `<c r="${ref}"${sAttr}${tAttr}>${built.inner}</c>`;
    });
  }

  const text = (v) => () => {
    if (v == null || v === '') return null;
    return { t: 'inlineStr', inner: `<is><t xml:space="preserve">${escapeXml(v)}</t></is>` };
  };
  const num = (v) => () => (v == null ? null : { inner: `<v>${v}</v>` });

  // Befüllt die sheet-XML mit den Modelldaten.
  function patchSheet(xml, model, fehlend) {
    // Projektkopf
    xml = setCell(xml, 'G3', text(model.filiale), fehlend);
    xml = setCell(xml, 'E5', num(excelSerial(model.datum)), fehlend);
    xml = setCell(xml, 'E6', text(model.beauftragung || 'NFK Vollverkabelung'), fehlend);
    xml = setCell(xml, 'G7', num(model.anzTechniker != null && model.anzTechniker !== ''
      ? parseInt(model.anzTechniker, 10) : null), fehlend);

    // Techniker-Tabelle Zeilen 8..12 (immer alle 5 setzen, ungenutzte leeren)
    for (let i = 0; i < MAX_ROWS; i++) {
      const row = 8 + i;
      const r = (model.rows && model.rows[i]) || {};
      xml = setCell(xml, 'B' + row, text(r.name), fehlend);
      xml = setCell(xml, 'I' + row, num(timeFraction(r.start)), fehlend);
      xml = setCell(xml, 'K' + row, num(timeFraction(r.ende)), fehlend);
      xml = setCell(xml, 'M' + row, num(timeFraction(r.pause)), fehlend);
      xml = setCell(xml, 'O' + row, text(r.bemerkung), fehlend);
    }

    // Textblöcke (mehrzeilig; wrapText ist im Zellstil hinterlegt)
    xml = setCell(xml, 'E14', text(model.taetigkeiten), fehlend);
    xml = setCell(xml, 'E16', text(model.behinderungen), fehlend);
    xml = setCell(xml, 'E19', text(model.vorkommnisse), fehlend);

    // Fußzeile „Ort Datum"
    xml = setCell(xml, 'B22', text(model.ortDatum), fehlend);
    return xml;
  }

  async function generateBlob(model) {
    const resp = await fetch(TEMPLATE_URL);
    if (!resp.ok) throw new Error('Vorlage konnte nicht geladen werden.');
    const buf = await resp.arrayBuffer();

    const zip = await JSZip.loadAsync(buf);
    const sheetFile = zip.file(SHEET_PATH);
    if (!sheetFile) throw new Error('Vorlage: Tabellenblatt nicht gefunden.');

    let xml = await sheetFile.async('string');
    const fehlend = [];
    xml = patchSheet(xml, model, fehlend);
    if (fehlend.length) {
      throw new Error('Die Bautagebuch-Vorlage passt nicht zur App: die Zellen '
        + fehlend.join(', ') + ' fehlen darin. Eingaben wären verlorengegangen.');
    }
    zip.file(SHEET_PATH, xml);

    return zip.generateAsync({
      type: 'blob',
      mimeType: MIME,
      compression: 'DEFLATE',
    });
  }

  // Dateiname: Bautagebuch_LI<Filialnummer>_<Ort>_<YYYY_MM_DD>.xlsx
  // (entspricht dem Muster der Vorlage „Bautagebuch LI7265 Memmingen 2025_09_11").
  // Aus der Filiale wird die führende Nummer extrahiert, damit der Ort – der in der
  // Filialangabe „7265 Memmingen" oft schon steckt – nicht doppelt erscheint.
  function buildName(model) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const filRaw = clean(model.filiale);
    const ort = clean(model.ort).replace(/\s+/g, '_');
    const nr = App.filialNr(filRaw) || (filRaw.match(/\d+/) || [])[0];
    const fil = (nr || filRaw).replace(/\s+/g, '_');
    const d = Datum.fuerDatei(model.datum);
    const parts = ['Bautagebuch', 'LI' + fil];
    if (ort) parts.push(ort);
    parts.push(d);
    return parts.join('_').replace(/_+/g, '_') + '.xlsx';
  }

  async function exportFile(model) {
    const blob = await generateBlob(model);
    const name = buildName(model);
    await App.shareFile(blob, name, MIME, `Bautagebuch ${model.datum || ''}`.trim());
    return name;
  }

  return { generateBlob, exportFile, buildName, excelSerial, timeFraction, patchSheet };
})();
