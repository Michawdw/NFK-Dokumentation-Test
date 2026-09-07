/* merge.js – führt die Bild-ZIP eines anderen Geräts in den aktuellen Auftrag ein.
   Ablauf: ZIP lesen -> Übergabestand (Excel/uebersicht.csv) prüfen -> bei abweichender
   Struktur nachfragen und die des Kollegen übernehmen -> manifest.json (oder Ordner-
   Fallback) -> Bilder pro Position fortlaufend weiternummeriert anhängen.
   Duplikatschutz über die eindeutige Bild-ID (srcId): bereits vorhandene Bilder werden
   übersprungen, sodass mehrfaches Importieren derselben ZIP nichts doppelt einfügt.
   Vorhandene Bilder werden NIE umbenannt oder überschrieben (append-only). */
const Merge = (() => {

  // ------------------------------------------------------------ Zuordnung
  // Der harte Schlüssel ist 'Ober␟Unter␟Bildname'. Stammt die ZIP aus einer älteren
  // App- oder Vorlagen-Version, weichen die Namen minimal ab („01_Kassenzone" früher,
  // „Kassenzone" heute) – dann passt kein einziger Schlüssel und JEDE Position würde als
  // eigener Knoten „von Kollege" neu angelegt: die Vorlage stünde doppelt im Baum.
  // Deshalb wird zusätzlich normalisiert verglichen.
  function normPart(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/^\s*\d+[_\-. ]+/, '')      // führendes Zähl-Präfix: „01_", „02 - ", Filialnr.
      // Umlaute und ihre Umschreibungen gleichsetzen: wurde eine Vorlage einmal ohne
      // Umlaute gepflegt, ist „Sozialraeume" dieselbe Position wie „Sozialräume".
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ')         // Trenner vereinheitlichen (siehe unten)
      .trim();
  }
  // Warum alle Sonderzeichen zu Leerzeichen: der ZIP-Export schreibt Ordnernamen durch
  // safePart(), aus „Allgemein / CCTV / Exit /Blitz" wird der Ordner
  // „Allgemein _ CCTV _ Exit _Blitz". Ohne diese Vereinheitlichung fänden ZIPs ohne
  // manifest.json (ganz alte Sicherungen) ihre Position nur noch über den Bildnamen.

  function normKey(ober, unter, bildname) {
    return [normPart(ober), normPart(unter), normPart(bildname)].join('␟');
  }

  // exact: harter Schlüssel · norm: normalisierter Schlüssel ·
  // byName: normalisierter Bildname -> Knoten (null = mehrdeutig, dann nicht verwenden).
  function buildNodeIndex(nodes) {
    const exact = new Map(), norm = new Map(), byName = new Map();
    for (const n of nodes || []) {
      exact.set(n.key, n);
      const nk = normKey(n.ober, n.unter, n.bildname);
      if (!norm.has(nk)) norm.set(nk, n);
      const bn = normPart(n.bildname);
      byName.set(bn, byName.has(bn) ? null : n);
    }
    return { exact, norm, byName };
  }

  // Wie oft kommt ein Bildname auf der Gegenseite vor? Stufe 3 unten darf nur greifen,
  // wenn der Name auch DORT eindeutig ist – sonst wanderten mehrere verschiedene
  // Positionen des Kollegen („Übersicht" in fünf Ordnern) in eine einzige eigene.
  function buildFremdNameCount(liste) {
    const c = new Map();
    for (const x of liste || []) {
      const bn = normPart(x.bildname);
      c.set(bn, (c.get(bn) || 0) + 1);
    }
    return c;
  }

  // Liefert den passenden eigenen Knoten oder null. Der Bildname allein zählt erst
  // zuletzt und nur, wenn er auf beiden Seiten eindeutig ist – lieber ein Knoten
  // „von Kollege" als ein Bild im falschen Ordner.
  function resolveNode(e, index, fremdCount) {
    const treffer = index.exact.get(e.nodeKey)
      || index.norm.get(normKey(e.ober, e.unter, e.bildname));
    if (treffer) return treffer;
    const bn = normPart(e.bildname);
    if (fremdCount && fremdCount.get(bn) > 1) return null;
    return index.byName.get(bn) || null;
  }

  // ------------------------------------------------------- Wurzelordner in der ZIP
  // Wird eine Bilddoku-ZIP unterwegs einmal entpackt und neu gepackt (Windows „Alle
  // extrahieren", viele Datei-Manager und Cloud-Apps machen das beim Weiterleiten),
  // steckt der gesamte Inhalt danach in EINEM Ordner mit dem Namen der ZIP-Datei.
  // Folge ohne Behandlung: manifest.json/uebersicht.csv/Übergabe-.xlsx werden nicht
  // gefunden, und der Ordner-Fallback liest den ZIP-Namen als Oberordner – alle Bilder
  // landen in einer einzigen neuen Position „Bilddoku_LI…" statt in der Struktur.
  // Erkennungsmerkmal ist eine der drei Dateien: nur wenn sie eine Ebene tiefer liegt,
  // wird gekürzt. Ein echter Oberordner („Kassenzone") wird dadurch nie abgeschnitten.
  function hatKennung(z) {
    return !!(z.file('manifest.json') || z.file('uebersicht.csv') || wurzelXlsx(z).length);
  }

  // Alle .xlsx direkt im (Unter-)Wurzelverzeichnis – die beigelegte Übergabe-Mappe.
  function wurzelXlsx(z) {
    return z.filter((rel, f) => !f.dir && /^[^/]+\.xlsx$/i.test(rel));
  }

  // Einziger gemeinsamer Unterordner, oder null (mehrere Ordner / Dateien liegen direkt drin).
  function einzigerUnterordner(z) {
    let name = null, mehrdeutig = false;
    z.forEach((rel, f) => {
      if (mehrdeutig || f.dir) return;
      const i = rel.indexOf('/');
      if (i < 0) { mehrdeutig = true; return; }
      const erster = rel.slice(0, i);
      if (name === null) name = erster; else if (name !== erster) mehrdeutig = true;
    });
    return mehrdeutig ? null : name;
  }

  function zipInhalt(zip) {
    let inhalt = zip, wurzel = '';
    for (let tiefe = 0; tiefe < 5 && !hatKennung(inhalt); tiefe++) {
      const ordner = einzigerUnterordner(inhalt);
      if (!ordner) break;
      inhalt = inhalt.folder(ordner);
      wurzel = wurzel ? wurzel + '/' + ordner : ordner;
    }
    // Ohne Kennung nichts kürzen – lieber der bisherige Weg als Bilder ohne Oberordner.
    return hatKennung(inhalt) ? { inhalt, wurzel } : { inhalt: zip, wurzel: '' };
  }

  // Nachschlagetabelle „so schreibt der Export diese Position" -> echter Knoten.
  // Nötig, weil der Export den Pfad zweifach verändert: Ordner-/Dateinamen werden über
  // safePart() bereinigt (aus „Allgemein / CCTV" wird „Allgemein _ CCTV"), und dem
  // Bildnamen wird die Filialnummer vorangestellt („7265_Kassen Totale_01.jpg").
  // Ohne diese Rückabbildung entstünde beim Fallback-Import eine zweite Position neben
  // der echten – doppelter Eintrag in der Übersicht, Nummerierung wieder ab 01.
  function buildExportPathIndex(knownNodes) {
    const sp = ExportZip.safePart;
    const idx = new Map();
    for (const n of knownNodes || []) {
      const folder = [sp(n.ober)].concat(n.unter ? [sp(n.unter)] : []).join('/');
      idx.set(folder + '/' + sp(n.bildname), n);
    }
    return idx;
  }

  // Kennung eines ZIP-Eintrags aus Prüfsumme und Größe. Gebraucht für die srcId in ZIPs
  // OHNE manifest.json: dort war die srcId früher allein der Pfad – und zwei Kollegen
  // derselben Filiale erzeugen für dieselbe Position exakt denselben Pfad
  // ("Kassenzone/7265_Kassen Totale_01.jpg"). Beim zweiten Import hielt der Duplikatschutz
  // die fremden Bilder für bereits vorhanden und verwarf sie still. Mit Prüfsumme dedupt
  // ein echter Re-Import weiterhin, verschiedene Bilder kollidieren aber nicht mehr.
  function legacySrcId(path, file) {
    const d = file && file._data;
    const k = (d && d.crc32 != null) ? d.crc32 + '_' + (d.uncompressedSize || 0) : null;
    return 'legacy:' + (k ? k + ':' : '') + path; // ohne Prüfsumme wie bisher nur der Pfad
  }

  // Liest die Foto-Liste aus manifest.json; fällt sonst auf die Ordnerstruktur zurück.
  // knownNodes wird nur im Fallback gebraucht (Rückabbildung des Exportpfads).
  async function readEntries(zip, knownNodes) {
    const mf = zip.file('manifest.json');
    if (mf) {
      try {
        const data = JSON.parse(await mf.async('string'));
        if (data && Array.isArray(data.photos)) return data.photos;
      } catch (e) { console.warn('manifest.json unlesbar, nutze Ordner-Fallback', e); }
    }
    // Fallback: aus Pfaden Ober/[Unter/]<Bildname>_NN.jpg ableiten (für alte ZIPs).
    const idx = buildExportPathIndex(knownNodes);
    const entries = [];
    zip.forEach((path, file) => {
      if (file.dir) return;
      if (!/\.jpe?g$/i.test(path)) return;
      // Fotos der Baubehinderungsanzeigen liegen in einem eigenen Ordner und sind KEINE
      // Bilddoku-Position – sie würden hier sonst als eigener Name angelegt und tauchten
      // damit in der Übersicht auf.
      if (/^Baubehinderung\//i.test(path)) return;
      const parts = path.split('/');
      const fname = parts.pop();
      const dir = parts.join('/');
      const m = fname.match(/^(.*)_(\d+)\.jpe?g$/i);
      const roh = m ? m[1] : fname.replace(/\.jpe?g$/i, '');
      const seq = m ? parseInt(m[2], 10) : 0;

      // Erst mit, dann ohne Filialpräfix nachschlagen. Nur bei einem Treffer wird der
      // echte Knoten übernommen – ein Bildname, der wirklich mit Ziffern beginnt, bleibt
      // dadurch unangetastet.
      const node = idx.get(dir + '/' + roh) || idx.get(dir + '/' + roh.replace(/^\d+_/, ''));
      if (node) {
        entries.push({
          srcId: legacySrcId(path, file),
          nodeKey: node.key,
          ober: node.ober, unter: node.unter || null, bildname: node.bildname,
          pflicht: node.pflicht || 1, seq, createdAt: null, path,
        });
        return;
      }

      // Kein Treffer: wie bisher aus dem Pfad ableiten. Die normalisierte Zuordnung
      // unten bekommt damit trotzdem noch eine Chance.
      const ober = parts[0] || 'Allgemein';
      const unter = parts.length > 1 ? parts[1] : null;
      entries.push({
        srcId: legacySrcId(path, file), // stabil pro Bildinhalt -> Re-Import dedupt
        nodeKey: Structure.makeKey(ober, unter, roh),
        ober, unter, bildname: roh, pflicht: 1, seq, createdAt: null, path,
      });
    });
    return entries;
  }

  // Eigener Ist-Stand je Position VOR dem Import (übernommener Zähler + eigene Bilder).
  // Wird gebraucht, um hinterher die Zähler richtig zu verrechnen; ein einziger Lesevorgang
  // statt eines countPhotos() je Position.
  async function eigenerStand(job) {
    const stand = new Map();
    const prior = job.priorCounts || {};
    for (const k of Object.keys(prior)) stand.set(k, prior[k] || 0);
    for (const p of await DB.getBilddokuPhotos(job.id)) {
      stand.set(p.nodeKey, (stand.get(p.nodeKey) || 0) + 1);
    }
    return stand;
  }

  function zaehleUnbekannt(entries, index, fremdCount) {
    const offen = new Set();
    for (const e of entries) if (!resolveNode(e, index, fremdCount)) offen.add(e.nodeKey);
    return offen.size;
  }

  // Vierstellige Filialnummer aus den Bild-Dateinamen im Paket („7423_Kassen Totale_01.jpg").
  // Zweite Quelle für ganz alte ZIPs, die außer der uebersicht.csv keine Kopfdaten haben.
  // Mehrheitswert, damit ein einzelner Ausreißer (fremdes Bild von Hand dazugelegt) nicht
  // die ganze Prüfung kippt.
  function filialNrAusBildern(zip) {
    const zaehl = new Map();
    zip.forEach((rel, f) => {
      if (f.dir || !/\.jpe?g$/i.test(rel)) return;
      const m = String(rel).split('/').pop().match(/^(\d{4})(?!\d)/);
      if (m) zaehl.set(m[1], (zaehl.get(m[1]) || 0) + 1);
    });
    let best = null, max = 0;
    for (const [nr, anzahl] of zaehl) if (anzahl > max) { max = anzahl; best = nr; }
    return best;
  }

  // Nimmt eine Datei ODER ein bereits geöffnetes JSZip entgegen: app.js muss die ZIP
  // zur Typerkennung ohnehin öffnen und soll sie nicht ein zweites Mal einlesen müssen
  // (auf der Baustelle sind das schnell einige hundert MB).
  //   opts.dateiname  Name der ZIP – letzte Quelle für die Filialnummer
  //   opts.pruefen    (paket, zielAuftrag) => null (abbrechen) | { kopfFelder: [...] }.
  //                   Wird aufgerufen, sobald der Kopf des Pakets gelesen ist und BEVOR
  //                   irgendetwas geschrieben wird.
  async function importContributionZip(fileOderZip, opts) {
    const o = opts || {};
    const roh = (fileOderZip && typeof fileOderZip.file === 'function')
      ? fileOderZip
      : await JSZip.loadAsync(await fileOderZip.arrayBuffer());
    // Falls die ZIP unterwegs neu gepackt wurde: auf das echte Wurzelverzeichnis gehen.
    const { inhalt: zip, wurzel } = zipInhalt(roh);
    // Übergabestand der ZIP: beigelegte Übergabe-.xlsx, sonst uebersicht.csv (+ manifest.json
    // für die Kopfdaten). Null nur bei ZIPs, die keine dieser Dateien enthalten.
    const uebergabe = await Handover.readFromZip(zip);

    let job = App.getCurrentJob();
    let jobNeu = false, strukturUebernommen = false;
    let kopfFelder = [];

    // Gehört das Paket überhaupt zu dieser Baustelle? Prüfen, BEVOR etwas geschrieben wird –
    // ein Abbruch muss den Auftrag unangetastet lassen. Zielauftrag ist der aktuelle; wird
    // gleich einer neu angelegt, gibt es nichts zu vergleichen.
    if (o.pruefen) {
      const kv = (uebergabe && uebergabe.kv) || {};
      const antwort = await o.pruefen({
        filiale: kv.filiale || '',
        ort: kv.ort || '',
        filialNr: App.filialNr(kv.filiale) || filialNrAusBildern(zip) || App.filialNr(o.dateiname),
      }, job || null);
      if (!antwort) return { abgebrochen: true };
      kopfFelder = antwort.kopfFelder || [];
    }

    // Kein Auftrag aktiv: aus der ZIP einen anlegen – es gibt nichts zu überschreiben,
    // also auch nichts zu fragen.
    if (!job) {
      if (!uebergabe) {
        throw new Error('Kein Auftrag aktiv – und die ZIP enthält keine Übergabe-Daten.');
      }
      const r = await Handover.applyHandoverData(uebergabe.kv, uebergabe.rows);
      await App.adoptJob(r.job);
      job = r.job;
      jobNeu = strukturUebernommen = true;
    }

    // Vom Nutzer freigegebene Stammdaten übernehmen (Feld für Feld entschieden).
    if (kopfFelder.length && uebergabe) {
      const h = job.header || (job.header = {});
      const alteFiliale = String(h.filiale || '');
      for (const feld of kopfFelder) h[feld] = uebergabe.kv[feld] || '';
      // Auftragsname zieht nur mit, wenn er nichts Eigenes war – sonst hieße ein bewusst
      // vergebener Name plötzlich anders. Gleiche Regel wie beim Speichern des Projektkopfs.
      if (kopfFelder.indexOf('filiale') !== -1
          && (!job.name || job.name === alteFiliale || /^Auftrag \d+$/.test(job.name))) {
        job.name = h.filiale || job.name;
      }
      await DB.saveJob(job);
    }

    const standVorher = await eigenerStand(job);

    let knownNodes = Structure.getMerged();
    const entries = await readEntries(zip, knownNodes);
    if (!entries.length) throw new Error('ZIP enthält keine Bilder.');

    // Namenshäufigkeit auf der Gegenseite: aus dem Übergabestand, ersatzweise aus den
    // mitgelieferten Bildern.
    const fremdCount = buildFremdNameCount(uebergabe ? uebergabe.rows : entries);

    let index = buildNodeIndex(knownNodes);
    let unbekannt = zaehleUnbekannt(entries, index, fremdCount);

    // Struktur weicht ab -> anbieten, die des Kollegen zu übernehmen. Danach passen die
    // Schlüssel wieder und die Bilder landen in den eigenen Positionen statt in einem
    // zweiten Baum daneben.
    if (unbekannt > 0 && uebergabe && !strukturUebernommen) {
      const ok = await App.openConfirm(
        'Andere Vorlagen-Version',
        `<p>Die ZIP enthält <b>${unbekannt}</b> Position(en), die es in deinem Auftrag nicht
          gibt – sie stammt vermutlich aus einer älteren Vorlagen-Version.</p>
         <p>Struktur des Kollegen übernehmen? Dann landen alle Bilder in den passenden
          Positionen statt in einem zweiten Bereich „von Kollege".</p>
         <p class="hint">Deine eigenen Bilder, eigenen Namen und dein Projektkopf bleiben
          erhalten.</p>`,
        'Struktur übernehmen');
      if (ok) {
        const r = await Handover.applyHandoverData(uebergabe.kv, uebergabe.rows, { job, soft: true });
        job = r.job;
        strukturUebernommen = true;
        knownNodes = Structure.getMerged();
        index = buildNodeIndex(knownNodes);
        unbekannt = zaehleUnbekannt(entries, index, fremdCount);
      }
    }

    // Positionen des Kollegen auf die eigenen abbilden (null = gibt es hier nicht).
    const mapKey = (r) => {
      const node = resolveNode({
        nodeKey: Structure.makeKey(r.ober, r.unter, r.bildname),
        ober: r.ober, unter: r.unter, bildname: r.bildname,
      }, index, fremdCount);
      return node ? node.key : null;
    };

    // Struktur passt (oder wurde nicht übernommen): dann wenigstens den STAND des
    // Kollegen mitnehmen – Zähler und „nicht benötigt". Sonst käme der Stand nur dann an,
    // wenn die Vorlagen zufällig auseinanderlaufen und die Rückfrage erschien.
    if (uebergabe && !strukturUebernommen) {
      await Handover.applyHandoverData(uebergabe.kv, uebergabe.rows, { job, nurStatus: true, mapKey });
    }

    // Ist-Anzahl des Kollegen je Position – auf die EIGENEN Schlüssel abgebildet, damit
    // die Zähler unten stimmen, auch wenn die Namen leicht abweichen.
    const istAusZip = new Map();
    for (const r of (uebergabe ? uebergabe.rows : [])) {
      const key = mapKey(r) || Structure.makeKey(r.ober, r.unter, r.bildname);
      istAusZip.set(key, Math.max(istAusZip.get(key) || 0, r.ist || 0));
    }

    const existingSrc = await DB.getPhotoSrcIds(job.id);
    if (!job.customNames) job.customNames = [];
    const knownKeys = new Set(knownNodes.map((n) => n.key));

    // Sortierung: nach Position, dann Aufnahmezeit/seq, damit die Reihenfolge stimmt.
    entries.sort((a, b) =>
      a.nodeKey === b.nodeKey
        ? (a.createdAt || a.seq || 0) - (b.createdAt || b.seq || 0)
        : a.nodeKey < b.nodeKey ? -1 : 1);

    const nextSeq = new Map();   // nodeKey -> nächste freie Nummer
    const zielKeys = new Set();  // Positionen, für die die ZIP Bilder mitbringt
    let added = 0, skipped = 0, missing = 0;
    const addedNodes = [];

    for (const e of entries) {
      const srcId = e.srcId || ('nosrc:' + e.path);

      // Zielposition bestimmen: eigener Knoten, sonst als eigenen Namen ergänzen.
      const node = resolveNode(e, index, fremdCount);
      const key = node ? node.key : e.nodeKey;
      // Auch bei bereits vorhandenen Bildern merken: die Zähler dieser Position müssen
      // unten trotzdem verrechnet werden, sonst zählt ein zweiter Import doppelt.
      zielKeys.add(key);
      if (existingSrc.has(srcId)) { skipped++; continue; }

      // Blob ZUERST holen: fehlt die Datei im Archiv (abgebrochene Kopie, gekürztes
      // Weiterleiten), darf keine leere Position "von Kollege" im Baum zurückbleiben.
      const zf = zip.file(e.path);
      if (!zf) { missing++; continue; }
      const blob = await zf.async('blob');

      if (!node && !knownKeys.has(key)) {
        const neu = {
          key, ober: e.ober || 'Allgemein', unter: e.unter || null,
          // 'merge' statt 'custom': im Baum als „von Kollege" gekennzeichnet, damit beim
          // Löschen erkennbar ist, dass daran fremde Bilder hängen.
          bildname: e.bildname, pflicht: e.pflicht || 1, source: 'merge',
        };
        job.customNames.push(neu);
        knownKeys.add(key);
        index.exact.set(key, neu);
        addedNodes.push(e.bildname);
      }

      // Fortlaufende Nummer bestimmen: an den eigenen Stand vor dem Import anhängen.
      // Bewusst NICHT an job.priorCounts – der kann den Stand des Kollegen enthalten,
      // dessen Bilder hier gerade physisch ankommen (sonst Lücken in der Nummerierung).
      if (!nextSeq.has(key)) nextSeq.set(key, (standVorher.get(key) || 0) + 1);
      const seq = nextSeq.get(key);
      nextSeq.set(key, seq + 1);

      await DB.addPhoto({
        jobId: job.id,
        nodeKey: key,
        seq,
        blob,
        createdAt: e.createdAt || Date.now(),
        // Wann das Bild auf DIESES Gerät kam. createdAt trägt die Aufnahmezeit des Kollegen
        // und liegt oft vor der eigenen letzten Sicherung – ohne importedAt meldete die
        // Backup-Erinnerung direkt nach dem Merge "alles gesichert".
        importedAt: Date.now(),
        srcId, // Original-srcId behalten -> künftiger Re-Import dedupt
      });
      existingSrc.add(srcId);
      added++;
    }

    // --- Zähler verrechnen ---------------------------------------------------
    // Angezeigt wird ist = priorCounts + physisch vorhandene Bilder. Sind die Bilder des
    // Kollegen jetzt physisch da, darf sein Zähler nicht zusätzlich mitzählen – sonst
    // stünde dort 6/3. Sollstand ist der höhere der beiden Stände.
    if (!job.priorCounts) job.priorCounts = {};
    for (const key of zielKeys) {
      const soll = Math.max(standVorher.get(key) || 0, istAusZip.get(key) || 0);
      const lokal = await DB.countPhotos(job.id, key);
      const prior = Math.max(0, soll - lokal);
      if (prior > 0) job.priorCounts[key] = prior; else delete job.priorCounts[key];
      // Lückenlos durchnummerieren: prior+1 … prior+n (nach Aufnahmezeit).
      await DB.renumberNode(job.id, key, prior);
    }

    await App.saveCurrentJob();
    return { added, skipped, missing, addedNodes, unbekannt, strukturUebernommen, jobNeu, wurzel, kopfFelder };
  }

  return { importContributionZip, zipInhalt };
})();
