/* photos.js – Foto verarbeiten: EXIF-Orientation auswerten, auf max. 1920 px
   lange Kante skalieren, als JPEG ~80 % speichern. Fortlaufende Nummerierung je
   Position; nach dem Löschen eines Bildes wird lückenlos neu nummeriert. */
const Photos = (() => {
  const MAX_EDGE = 1920;
  const QUALITY = 0.80;

  // Liest EXIF-Orientation (1..8) aus einem JPEG-ArrayBuffer; 1 wenn nicht gefunden.
  function readOrientation(buffer) {
    const view = new DataView(buffer);
    if (view.byteLength < 2 || view.getUint16(0, false) !== 0xffd8) return 1; // kein JPEG
    let offset = 2;
    const len = view.byteLength;
    while (offset < len) {
      if (view.getUint16(offset, false) !== 0xffe1) {
        // Kein APP1; zum nächsten Marker springen.
        if ((view.getUint16(offset, false) & 0xff00) !== 0xff00) break;
        offset += 2 + view.getUint16(offset + 2, false);
        continue;
      }
      // APP1 gefunden – auf "Exif\0\0" prüfen.
      const exifLen = view.getUint16(offset + 2, false);
      if (view.getUint32(offset + 4, false) !== 0x45786966) return 1; // "Exif"
      const tiff = offset + 10;
      const little = view.getUint16(tiff, false) === 0x4949;
      const dirOffset = view.getUint32(tiff + 4, little);
      let dir = tiff + dirOffset;
      const entries = view.getUint16(dir, little);
      for (let i = 0; i < entries; i++) {
        const entry = dir + 2 + i * 12;
        if (view.getUint16(entry, little) === 0x0112) {
          return view.getUint16(entry + 8, little) || 1;
        }
      }
      offset += 2 + exifLen;
    }
    return 1;
  }

  // Liefert {drawWidth, drawHeight, transform} für eine gegebene Orientation.
  function applyOrientation(ctx, orientation, w, h) {
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;            // horizontal spiegeln
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;           // 180°
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;            // vertikal spiegeln
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;             // transponieren
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;            // 90° CW
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;           // transponieren
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;            // 90° CCW
      default: break;                                             // 1: nichts
    }
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Komprimiert eine Bilddatei -> JPEG-Blob (ausgerichtet, max 2560px lange Kante).
  async function compress(file) {
    const buffer = await file.arrayBuffer();
    const orientation = readOrientation(buffer);
    const img = await loadImage(file);

    let w = img.naturalWidth, h = img.naturalHeight;
    // Bei 90°-Drehungen tauschen Ziel-Breite/Höhe.
    const swap = orientation >= 5 && orientation <= 8;
    let outW = swap ? h : w;
    let outH = swap ? w : h;

    // Skalierung auf lange Kante (kein Upscaling).
    const longEdge = Math.max(outW, outH);
    const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
    outW = Math.round(outW * scale);
    outH = Math.round(outH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    // Orientation-Transform auf das (skalierte) Ausgabesystem anwenden.
    ctx.save();
    applyOrientation(ctx, orientation, swap ? outH : outW, swap ? outW : outH);
    // Nach der Transform im ursprünglichen (un-getauschten) Koordinatensystem zeichnen.
    const drawW = swap ? outH : outW;
    const drawH = swap ? outW : outH;
    ctx.drawImage(img, 0, 0, drawW, drawH);
    ctx.restore();

    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY)
    );
  }

  // Verarbeitet eine Auswahl und speichert sie dem Knoten zugeordnet (append-only).
  // Nummerierung läuft über eine evtl. übernommene Vor-Anzahl (priorCount) hinaus weiter,
  // damit Bilder verschiedener Teams kollisionsfrei aufeinanderfolgen.
  async function addToNode(node, file) {
    const job = App.getCurrentJob();
    const blob = await compress(file);
    const prior = (job.priorCounts && job.priorCounts[node.key]) || 0;
    const local = await DB.countPhotos(job.id, node.key);
    const seq = prior + local + 1;
    const deviceId = await DB.getDeviceId();
    await DB.addPhoto({
      jobId: job.id,
      nodeKey: node.key,
      seq,
      blob,
      createdAt: Date.now(),
      // Eindeutige, geräteübergreifend stabile Bild-ID für den Merge-Duplikatschutz.
      srcId: deviceId + ':' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    });
    return seq;
  }

  // Löscht ein einzelnes Bild einer Position und nummeriert die verbleibenden
  // Bilder lückenlos neu (prior+1 … prior+n). Ohne das Neunummerieren bekäme das
  // nächste Foto eine bereits vergebene Nummer -> doppelte Dateinamen im Export.
  async function deleteFromNode(nodeKey, photoId) {
    const job = App.getCurrentJob();
    const prior = (job.priorCounts && job.priorCounts[nodeKey]) || 0;
    await DB.deletePhotoById(photoId);
    await DB.renumberNode(job.id, nodeKey, prior);
  }

  function fileName(node, seq) {
    const nn = String(seq).padStart(2, '0');
    return `${node.bildname}_${nn}.jpg`;
  }

  return { compress, addToNode, deleteFromNode, fileName, readOrientation, MAX_EDGE, QUALITY };
})();
