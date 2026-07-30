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

    // Filialnummer (führende Ziffern aus „7265 Memmingen" -> „7265") als Präfix der Bildnamen.
    const filMatch = String(project.filiale || '').match(/\d+/);
    const filPrefix = filMatch ? filMatch[0] + '_' : '';

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

    zip.file('uebersicht.csv', '﻿' + lines.join('\r\n'));
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    if (totalPhotos === 0) {
      App.toast('Noch keine Bilder aufgenommen.');
      return;
    }

    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const fname = buildZipName(project);
    await App.shareFile(blob, fname, 'application/zip',
      `Bilddoku ${project.filiale || ''}`.trim());
    return { totalPhotos, fname };
  }

  // Bilddoku_LI<Filialnummer>_<Ort>_Stand_<YYYY_MM_DD>.zip
  // (Filialnummer aus „7265 Memmingen" extrahiert, damit der Ort nicht doppelt erscheint).
  // „Stand" = Tag des Exports (nicht das Projekt-Datum): jede Sicherung ist vollständig
  // und eindeutig benannt – die neueste ersetzt alle älteren, die man löschen kann.
  function buildZipName(project) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const numMatch = clean(project.filiale).match(/\d+/);
    const fil = (numMatch ? numMatch[0] : clean(project.filiale) || 'Projekt').replace(/\s+/g, '_');
    const ort = clean(project.ort).replace(/\s+/g, '_');
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
    const parts = ['Bilddoku', 'LI' + fil];
    if (ort) parts.push(ort);
    parts.push('Stand', d);
    return parts.join('_').replace(/_+/g, '_') + '.zip';
  }

  return { build, safePart };
})();
