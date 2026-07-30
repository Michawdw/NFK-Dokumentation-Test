/* protokoll.js – erzeugt das Baustellen-Vorprüfungs-/Behinderungsprotokoll als .docx.
   Der OOXML-Container (ZIP, Absatz- und Bildbausteine) liegt in js/docx.js; hier wird
   nur noch das Modell auf Absätze abgebildet. Muster/Konventionen analog
   js/bautagebuch.js (IIFE, generateBlob/exportFile/buildName, App.shareFile).

   model = {
     filiale, ort, datum, beauftragung, auftragsname,
     points: [
       { titel, statusLabel,
         text,                                  // Freitext (nur bei Problemen relevant)
         photos: [ { blob: Blob(image/jpeg), caption } ] }
     ]
   }
*/
const Protokoll = (() => {
  const MIME = Docx.MIME;

  async function generateBlob(model) {
    const doc = Docx.create();

    // Kopf (bewusst ohne Logo – Aufbau wie bisher; für ein Logo hier `await doc.logo();`
    // ergänzen, siehe js/behinderung.js).
    doc.push(
      Docx.pTitle('Baustellen-Vorprüfung / Behinderungsprotokoll'),
      Docx.pEmpty(),
      model.auftragsname ? Docx.pHead('Auftrag', model.auftragsname) : null,
      Docx.pHead('Filiale / Bauvorhaben', model.filiale),
      Docx.pHead('Ort', model.ort),
      Docx.pHead('Datum', Docx.fmtDate(model.datum)),
      Docx.pHead('Beauftragung', model.beauftragung || 'NFK Vollverkabelung'),
      Docx.pEmpty()
    );

    // Prüfpunkte
    const points = model.points || [];
    for (let idx = 0; idx < points.length; idx++) {
      const pt = points[idx];
      const statusTxt = pt.statusLabel != null ? pt.statusLabel
        : (pt.status === 'nio' ? 'nicht i.O.' : 'i.O.'); // Rückwärtskompatibel
      doc.push(Docx.pBold(`${idx + 1}. ${pt.titel}${statusTxt ? ' — ' + statusTxt : ''}`));
      if (pt.text && pt.text.trim()) doc.push(Docx.pText(pt.text));
      for (const ph of (pt.photos || [])) {
        if (!ph || !ph.blob) continue;
        await doc.image(ph.blob, { ext: 'jpeg', caption: ph.caption });
      }
      doc.push(Docx.pEmpty());
    }

    return doc.toBlob();
  }

  // Dateiname: Vorpruefung_LI<Filialnr>_<Ort>_<YYYY_MM_DD>.docx (analog Bautagebuch).
  function buildName(model) {
    return Docx.buildFileName('Vorpruefung', model, 'docx');
  }

  async function exportFile(model) {
    const blob = await generateBlob(model);
    const name = buildName(model);
    await App.shareFile(blob, name, MIME, `Vorprüfung ${model.filiale || ''}`.trim());
    return name;
  }

  return { generateBlob, exportFile, buildName };
})();
