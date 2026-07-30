/* docx.js – gemeinsamer Baukasten für alle Word-Dokumente der App.
   Baut den OOXML-ZIP-Container komplett selbst per JSZip (keine Word-Bibliothek,
   keine Vorlage). Dadurch sind variable Text-, Bild- und Abschnittsmengen möglich.
   Genutzt von js/protokoll.js (Vorprüfungsprotokoll) und js/behinderung.js
   (Baubehinderungsanzeige). Ergebnis öffnet in Microsoft Word und Google Docs.

   Benutzung:
     const doc = Docx.create();
     await doc.logo();                       // Firmenlogo (assets/logo.png)
     doc.push(Docx.pTitle('Überschrift'));
     await doc.image(blob, { ext: 'jpeg' }); // Foto, auf 15 cm Breite begrenzt
     const blob = await doc.toBlob();

   Maßeinheiten: EMU (914400 pro Zoll) für Bilder, half-points für Schriftgrößen,
   Twips (1/20 pt) für Seitenränder.
*/
const Docx = (() => {
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const EMU_PER_PX = 9525;          // 914400 EMU/Zoll ÷ 96 dpi
  const EMU_PER_CM = 360000;
  const MAX_W_EMU = 15 * EMU_PER_CM; // 15 cm maximale Bildbreite (A4, ~2 cm Rand)
  const LOGO_URL = 'assets/logo.png';
  const LOGO_W_EMU = 4.5 * EMU_PER_CM;

  let logoBlobCache = null; // Logo nur einmal je Sitzung laden

  // ---- XML-Helfer ----
  const escapeXml = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeAttr = (s) => escapeXml(s).replace(/"/g, '&quot;');

  // Pixelmaße eines Bild-Blobs (bevorzugt createImageBitmap, sonst Image-Fallback).
  async function imageSizePx(blob) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(blob);
        const s = { w: bmp.width, h: bmp.height };
        bmp.close();
        return s;
      } catch (e) { /* Fallback unten */ }
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // Pixelmaße -> EMU. widthEmu erzwingt eine feste Breite (z. B. Logo),
  // sonst wird nur auf maxWidthEmu heruntergerechnet; optional zusätzlich auf
  // maxHeightEmu begrenzt (z. B. damit Hochkantfotos nicht fast eine ganze Seite
  // füllen). Seitenverhältnis bleibt in jedem Fall erhalten.
  function emuSize(px, opts) {
    const o = opts || {};
    const w = Math.max(1, px.w), h = Math.max(1, px.h);
    if (o.widthEmu) {
      return { cx: Math.round(o.widthEmu), cy: Math.round(o.widthEmu * h / w) };
    }
    let cx = w * EMU_PER_PX;
    let cy = h * EMU_PER_PX;
    const maxW = o.maxWidthEmu || MAX_W_EMU;
    if (cx > maxW) { cy = cy * maxW / cx; cx = maxW; }
    if (o.maxHeightEmu && cy > o.maxHeightEmu) { cx = cx * o.maxHeightEmu / cy; cy = o.maxHeightEmu; }
    return { cx: Math.round(cx), cy: Math.round(cy) };
  }

  // ---- Absatz-Bausteine ----
  // Mehrzeiliger Text: an \n splitten, Segmente mit <w:br/> verbinden, alles in EINEM w:r.
  function runText(str) {
    const parts = String(str == null ? '' : str).replace(/\r\n?/g, '\n').split('\n');
    return parts.map((p) => `<w:t xml:space="preserve">${escapeXml(p)}</w:t>`).join('<w:br/>');
  }
  const pPr = (align, extra) =>
    (align || extra) ? `<w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}${extra || ''}</w:pPr>` : '';

  const pText = (str) => `<w:p><w:r>${runText(str)}</w:r></w:p>`;
  const pBold = (str) => `<w:p><w:r><w:rPr><w:b/></w:rPr>${runText(str)}</w:r></w:p>`;
  const pEmpty = () => '<w:p/>';
  // Kopfzeile „Label: Wert" – Label fett, Wert normal.
  const pHead = (label, val) =>
    `<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(label)}: </w:t></w:r>` +
    `<w:r>${runText(val)}</w:r></w:p>`;
  // Überschrift größer (32 half-points = 16 pt, fett).
  const pTitle = (str) =>
    `<w:p><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>${runText(str)}</w:r></w:p>`;
  // Rechtsbündiger Absatz (z. B. „Ort, den Datum").
  const pRight = (str) =>
    `<w:p>${pPr('right')}<w:r>${runText(str)}</w:r></w:p>`;
  // Kleiner Text, eng gesetzt (Absenderzeile über dem Anschriftenfeld).
  const pSmall = (str) =>
    `<w:p>${pPr(null, '<w:spacing w:after="0"/>')}<w:r><w:rPr><w:sz w:val="16"/></w:rPr>${runText(str)}</w:r></w:p>`;
  // Absatz ohne Abstand nach unten – für zusammenhängende Adressblöcke.
  const pTight = (str) =>
    `<w:p>${pPr(null, '<w:spacing w:after="0"/>')}<w:r>${runText(str)}</w:r></w:p>`;
  const pPageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  // Ein eingebettetes Bild als eigener Absatz.
  function drawingParagraph(rid, seq, emu, align) {
    return `<w:p>${pPr(align)}<w:r><w:drawing>` +
      '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${emu.cx}" cy="${emu.cy}"/>` +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      `<wp:docPr id="${seq}" name="Bild ${seq}"/>` +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="${seq}" name="Bild ${seq}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu.cx}" cy="${emu.cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p>';
  }

  // Rahmenlose zweispaltige Tabelle für den Briefkopf: links die Absenderanschrift,
  // rechts das Logo – beide oben bündig, damit nichts versetzt steht. Ohne Tabelle
  // müssten Logo und Anschrift untereinander stehen (Absätze fließen nur vertikal).
  // Breiten in Twips; Textbreite A4 = 11906 - 2*1134 Rand = 9638.
  const TBL_W = 9638;
  const COL_LEFT = 5400;
  const COL_RIGHT = TBL_W - COL_LEFT;
  const NO_BORDER = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((s) => `<w:${s} w:val="none" w:sz="0" w:space="0" w:color="auto"/>`).join('');

  function twoColumnRow(leftXml, rightXml) {
    const cell = (w, content) =>
      `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>` +
      (content || '<w:p/>') + '</w:tc>';
    return '<w:tbl>' +
      '<w:tblPr>' +
      `<w:tblW w:w="${TBL_W}" w:type="dxa"/>` +
      '<w:tblLayout w:type="fixed"/>' +
      `<w:tblBorders>${NO_BORDER}</w:tblBorders>` +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
      '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr>' +
      `<w:tblGrid><w:gridCol w:w="${COL_LEFT}"/><w:gridCol w:w="${COL_RIGHT}"/></w:tblGrid>` +
      `<w:tr>${cell(COL_LEFT, leftXml)}${cell(COL_RIGHT, rightXml)}</w:tr>` +
      '</w:tbl>';
  }

  // ---- Feste Container-Teile ----
  // Schrift-Grundeinstellung, damit das Dokument in Word, LibreOffice und Google Docs
  // gleich aussieht (ohne styles.xml setzt jedes Programm seinen eigenen Standard).
  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults>' +
    '<w:rPrDefault><w:rPr>' +
    '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="de-DE"/>' +
    '</w:rPr></w:rPrDefault>' +
    '<w:pPrDefault><w:pPr>' +
    '<w:spacing w:after="120" w:line="259" w:lineRule="auto"/>' +
    '</w:pPr></w:pPrDefault>' +
    '</w:docDefaults>' +
    '</w:styles>';

  const SECT_PR =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"' +
    ' w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';

  const CONTENT_TYPES =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const ROOT_RELS =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  // ---- Dokument-Builder ----
  function create() {
    const body = [];   // Absatz-XML
    const media = [];  // { rid, file, blob }
    let relSeq = 1;    // rId1 ist für styles.xml reserviert -> Bilder ab rId2
    let imgSeq = 0;    // laufende Bildnummer (Dateiname + docPr/cNvPr id)

    const api = {
      // Ein oder mehrere fertige Absatz-XML-Strings anhängen (null/'' wird ignoriert).
      push(...xml) {
        for (const x of xml) {
          if (Array.isArray(x)) api.push(...x);
          else if (x) body.push(x);
        }
        return api;
      },

      // Bild registrieren und den fertigen Bildabsatz als XML zurückgeben (ohne ihn
      // anzuhängen) – nötig, damit Bilder auch in Tabellenzellen landen können.
      // opts: { ext:'jpeg'|'png', widthEmu, maxWidthEmu, maxHeightEmu, align }
      async imageXml(blob, opts) {
        const o = opts || {};
        const ext = o.ext || 'jpeg';
        imgSeq++;
        relSeq++;
        const rid = 'rId' + relSeq;
        const file = `image${imgSeq}.${ext}`;
        media.push({ rid, file, blob });

        let emu;
        try {
          emu = emuSize(await imageSizePx(blob), o);
        } catch (e) {
          // 4:3-Fallback, wenn die Pixelmaße nicht ermittelbar sind.
          const cx = o.widthEmu || o.maxWidthEmu || MAX_W_EMU;
          emu = { cx: Math.round(cx), cy: Math.round(cx * 3 / 4) };
        }
        return drawingParagraph(rid, imgSeq, emu, o.align);
      },

      // Bild als eigener Absatz einbetten. Zusätzlich zu imageXml: opts.caption
      async image(blob, opts) {
        const o = opts || {};
        body.push(await api.imageXml(blob, o));
        if (o.caption && String(o.caption).trim()) body.push(pText(o.caption));
        return api;
      },

      // Firmenlogo (assets/logo.png) als Absatz-XML – dieselbe Grafik wie im Bautagebuch.
      // Liefert '' , wenn die Datei fehlt: das Dokument entsteht dann eben ohne Logo.
      async logoXml(opts) {
        const o = opts || {};
        try {
          if (!logoBlobCache) {
            const resp = await fetch(LOGO_URL);
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            logoBlobCache = await resp.blob();
          }
          return await api.imageXml(logoBlobCache, {
            ext: 'png',
            widthEmu: o.widthEmu || LOGO_W_EMU,
            align: o.align || 'right',
          });
        } catch (e) {
          console.warn('Logo konnte nicht eingebettet werden:', e);
          return '';
        }
      },

      // Briefkopf: Absenderanschrift links, Logo rechts – oben bündig auf einer Höhe.
      // addressXml: Array fertiger Absatz-XML-Strings (z. B. Docx.pTight(...)).
      async letterhead(addressXml, opts) {
        const left = (addressXml || []).filter(Boolean).join('');
        const right = await api.logoXml(opts);
        body.push(twoColumnRow(left, right));
        return api;
      },

      async logo(opts) {
        try {
          const xml = await api.logoXml(opts);
          if (xml) body.push(xml);
        } catch (e) {
          console.warn('Logo konnte nicht eingebettet werden:', e);
        }
        return api;
      },

      async toBlob() {
        const zip = new JSZip();

        zip.file('[Content_Types].xml', CONTENT_TYPES);
        zip.file('_rels/.rels', ROOT_RELS);
        zip.file('word/styles.xml', STYLES_XML);

        zip.file('word/document.xml',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
          ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
          ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
          ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
          ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
          '<w:body>' + body.join('') + SECT_PR + '</w:body></w:document>');

        zip.file('word/_rels/document.xml.rels',
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          media.map((m) =>
            `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeAttr('media/' + m.file)}"/>`
          ).join('') +
          '</Relationships>');

        for (const m of media) zip.file('word/media/' + m.file, m.blob);

        return zip.generateAsync({ type: 'blob', mimeType: MIME, compression: 'DEFLATE' });
      },
    };
    return api;
  }

  // ---- gemeinsame Formatierer ----
  // 'YYYY-MM-DD' -> 'TT.MM.JJJJ' (unveränderte Rückgabe, wenn kein ISO-Datum).
  function fmtDate(datum) {
    if (!datum) return '';
    const m = String(datum).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}.${m[2]}.${m[1]}` : String(datum);
  }

  // Einheitliches Dateinamensmuster der App:
  //   <Prefix>_LI<Filialnummer>_<Ort>_<YYYY_MM_DD>.<ext>
  // Aus der Filiale wird die führende Nummer extrahiert, damit der Ort – der in der
  // Filialangabe „7265 Memmingen" oft schon steckt – nicht doppelt erscheint.
  function buildFileName(prefix, model, ext) {
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
    const filRaw = clean(model.filiale);
    const numMatch = filRaw.match(/\d+/);
    const fil = (numMatch ? numMatch[0] : filRaw || 'Projekt').replace(/\s+/g, '_');
    const ort = clean(model.ort).replace(/\s+/g, '_');
    const d = (model.datum || new Date().toISOString().slice(0, 10)).replace(/-/g, '_');
    const parts = [prefix, 'LI' + fil];
    if (ort) parts.push(ort);
    parts.push(d);
    return parts.join('_').replace(/_+/g, '_') + '.' + (ext || 'docx');
  }

  return {
    MIME, EMU_PER_CM, MAX_W_EMU,
    create, escapeXml, escapeAttr, fmtDate, buildFileName,
    pText, pBold, pEmpty, pHead, pTitle, pRight, pSmall, pTight, pPageBreak,
  };
})();
