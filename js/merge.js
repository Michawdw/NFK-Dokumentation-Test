/* merge.js – führt die Bild-ZIP eines anderen Geräts in den aktuellen Auftrag ein.
   Ablauf: ZIP lesen -> manifest.json (oder Ordner-Fallback) -> fehlende Positionen als
   eigene Namen ergänzen -> Bilder pro Position fortlaufend weiternummeriert anhängen.
   Duplikatschutz über die eindeutige Bild-ID (srcId): bereits vorhandene Bilder werden
   übersprungen, sodass mehrfaches Importieren derselben ZIP nichts doppelt einfügt.
   Vorhandene Bilder werden NIE umbenannt oder überschrieben (append-only). */
const Merge = (() => {

  // Liest die Foto-Liste aus manifest.json; fällt sonst auf die Ordnerstruktur zurück.
  async function readEntries(zip) {
    const mf = zip.file('manifest.json');
    if (mf) {
      try {
        const data = JSON.parse(await mf.async('string'));
        if (data && Array.isArray(data.photos)) return data.photos;
      } catch (e) { console.warn('manifest.json unlesbar, nutze Ordner-Fallback', e); }
    }
    // Fallback: aus Pfaden Ober/[Unter/]<Bildname>_NN.jpg ableiten (für alte ZIPs).
    const entries = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      if (!/\.jpe?g$/i.test(path)) return;
      const parts = path.split('/');
      const fname = parts.pop();
      const ober = parts[0] || 'Allgemein';
      const unter = parts.length > 1 ? parts[1] : null;
      const m = fname.match(/^(.*)_(\d+)\.jpe?g$/i);
      const bildname = m ? m[1] : fname.replace(/\.jpe?g$/i, '');
      const seq = m ? parseInt(m[2], 10) : 0;
      entries.push({
        srcId: 'legacy:' + path, // stabil pro ZIP-Pfad -> Re-Import dedupt
        nodeKey: Structure.makeKey(ober, unter, bildname),
        ober, unter, bildname, pflicht: 1, seq, createdAt: null, path,
      });
    });
    return entries;
  }

  async function importContributionZip(file) {
    const job = App.getCurrentJob();
    if (!job) throw new Error('Kein Auftrag aktiv.');

    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = await readEntries(zip);
    if (!entries.length) throw new Error('ZIP enthält keine Bilder.');

    const existingSrc = await DB.getPhotoSrcIds(job.id);
    const knownKeys = new Set(Structure.getMerged().map((n) => n.key));
    if (!job.customNames) job.customNames = [];

    // Sortierung: nach Position, dann Aufnahmezeit/seq, damit die Reihenfolge stimmt.
    entries.sort((a, b) =>
      a.nodeKey === b.nodeKey
        ? (a.createdAt || a.seq || 0) - (b.createdAt || b.seq || 0)
        : a.nodeKey < b.nodeKey ? -1 : 1);

    const nextSeq = new Map(); // nodeKey -> nächste freie Nummer
    let added = 0, skipped = 0, missing = 0;
    const addedNodes = [];

    for (const e of entries) {
      const srcId = e.srcId || ('nosrc:' + e.path);
      if (existingSrc.has(srcId)) { skipped++; continue; }

      // Position sicherstellen (fehlende als eigenen Namen ergänzen).
      if (!knownKeys.has(e.nodeKey)) {
        const node = {
          key: e.nodeKey, ober: e.ober || 'Allgemein', unter: e.unter || null,
          bildname: e.bildname, pflicht: e.pflicht || 1, source: 'custom',
        };
        job.customNames.push(node);
        knownKeys.add(e.nodeKey);
        addedNodes.push(e.bildname);
      }

      // Blob aus ZIP holen.
      const zf = zip.file(e.path);
      if (!zf) { missing++; continue; }
      const blob = await zf.async('blob');

      // Fortlaufende Nummer bestimmen (an vorhandene + bereits importierte anhängen).
      if (!nextSeq.has(e.nodeKey)) {
        const prior = (job.priorCounts && job.priorCounts[e.nodeKey]) || 0;
        const local = await DB.countPhotos(job.id, e.nodeKey);
        nextSeq.set(e.nodeKey, prior + local + 1);
      }
      const seq = nextSeq.get(e.nodeKey);
      nextSeq.set(e.nodeKey, seq + 1);

      await DB.addPhoto({
        jobId: job.id,
        nodeKey: e.nodeKey,
        seq,
        blob,
        createdAt: e.createdAt || Date.now(),
        srcId, // Original-srcId behalten -> künftiger Re-Import dedupt
      });
      existingSrc.add(srcId);
      added++;
    }

    if (addedNodes.length) await App.saveCurrentJob();
    return { added, skipped, missing, addedNodes };
  }

  return { importContributionZip };
})();
