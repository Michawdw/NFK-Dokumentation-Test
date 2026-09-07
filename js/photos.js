/* photos.js – Foto verarbeiten: EXIF-Orientation auswerten, auf max. 1920 px
   lange Kante skalieren, als JPEG ~80 % speichern. Fortlaufende Nummerierung je
   Position; nach dem Löschen eines Bildes wird lückenlos neu nummeriert. */
const Photos = (() => {
  const MAX_EDGE = 1920;
  const QUALITY = 0.80;

  // Aktuelle Browser (Chrome ab 81, Safari ab 13.1, Firefox ab 77) richten JPEGs beim
  // Dekodieren bereits selbst nach EXIF aus. Die Drehung hier ein ZWEITES Mal anzuwenden
  // legt Hochkantfotos quer – genau das passierte in Word-Protokoll und Bilder-ZIP.
  // Erkennung mit einem 2x1-Pixel-JPEG, das per EXIF um 90° gedreht ist: richtet der
  // Browser selbst aus, meldet er 1x2 statt 2x1. Ergebnis wird einmal je Sitzung gemerkt.
  const PROBE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDAFA3PEY8MlBGQUZaVVBfeMiCeG5uePWvuZHI////////////////////////////////////////////////////2wBDAVVaWnhpeOuCguv/////////////////////////////////////////////////////////////////////////wAARCAABAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwC7RRRQB//Z';
  let autoOrientCheck = null;
  function browserAutoOrients() {
    if (!autoOrientCheck) {
      autoOrientCheck = new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth === 1 && img.naturalHeight === 2);
        img.onerror = () => resolve(false); // im Zweifel selbst drehen (altes Verhalten)
        img.src = PROBE_JPEG;
      });
    }
    return autoOrientCheck;
  }

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
    // Die Datei nur einlesen, wenn die Drehung wirklich selbst ermittelt werden muss:
    // moderne Browser richten JPEGs beim Dekodieren bereits aus, dann wäre der komplette
    // Puffer (Handy-Foto: 5-12 MB) umsonst im Speicher.
    let orientation = 1;
    if (!(await browserAutoOrients())) {
      try {
        orientation = readOrientation(await file.arrayBuffer());
      } catch (e) {
        // Abgeschnittenes/defektes JPEG: lieber ungedreht weiterverarbeiten als das Foto
        // ganz zu verlieren.
        console.warn('EXIF-Orientierung nicht lesbar, nutze 1:', e);
        orientation = 1;
      }
    }
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

    // toBlob liefert bei Speichermangel oder Canvas-Limit null. Ohne diese Prüfung würde
    // ein Foto-Datensatz OHNE Bild gespeichert: die Position gälte als erledigt, ihre Zeile
    // verschwände aus dem Baum (createObjectURL(null) wirft) und der ZIP-Export erzeugte
    // eine 0-Byte-Datei – eine unsichtbare Lücke in der Dokumentation.
    const blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', QUALITY)
    );
    if (!blob || !blob.size) {
      throw new Error('Bild konnte nicht komprimiert werden (evtl. zu wenig Speicher).');
    }
    return blob;
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

  // fileName() gab es hier bis v38 zusätzlich – ungenutzt und ohne das Filialnummern-
  // Präfix, das der Export voranstellt. Entfernt, damit niemand versehentlich damit
  // Dateinamen baut. Maßgeblich ist export-zip.js.
  return { compress, addToNode, deleteFromNode, readOrientation,
           browserAutoOrients, MAX_EDGE, QUALITY };
})();
