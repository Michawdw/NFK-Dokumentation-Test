/* db.js – IndexedDB-Wrapper (Schema v3).
   Alles ist pro Auftrag (jobId) getrennt:
   - jobs:   ein Datensatz je Auftrag (Kopf, Struktur, eigene Namen, gewählte Vorlage,
             priorCounts = übernommene Ist-Anzahl je Position).
   - photos: Bilder mit jobId; Index byJobNode = [jobId, nodeKey]. Neue Bilder werden
             angehängt; beim Löschen wird die Position neu durchnummeriert (renumberNode).
   - diary2: Bautagebuch-Tage, keyPath [jobId, datum].
   - meta:   kleine Schlüssel/Werte (z. B. currentJobId, Migrationsflag).
   Beim Upgrade von v2 werden vorhandene Einzel-Auftragsdaten in einen Default-Auftrag
   migriert (nichts geht verloren). */
const DB = (() => {
  const NAME = 'nfk-doku';
  const VERSION = 3;
  let _db = null;
  let _ready = null;

  function rawOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;

        if (!db.objectStoreNames.contains('photos')) {
          const ps = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
          ps.createIndex('byNode', 'nodeKey', { unique: false });
        }
        const ps = tx.objectStore('photos');
        if (!ps.indexNames.contains('byJob')) ps.createIndex('byJob', 'jobId', { unique: false });
        if (!ps.indexNames.contains('byJobNode')) ps.createIndex('byJobNode', ['jobId', 'nodeKey'], { unique: false });

        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('diary2')) db.createObjectStore('diary2', { keyPath: ['jobId', 'datum'] });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        // Alt-Stores (project/structure/customNames/diary) werden NICHT gelöscht –
        // sie werden nach dem Öffnen für die Datenmigration ausgelesen.
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function open() {
    if (_ready) return _ready;
    _ready = rawOpen().then(async (db) => {
      _db = db;
      await migrateIfNeeded();
      return _db;
    });
    return _ready;
  }

  function store(name, mode) {
    // Sobald die Verbindung steht, direkt nutzen – wichtig, damit die Migration
    // (läuft INNERHALB der open()-Promise) sich nicht selbst blockiert.
    if (_db) return Promise.resolve(_db.transaction(name, mode).objectStore(name));
    return open().then((db) => db.transaction(name, mode).objectStore(name));
  }
  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Meta ----
  async function getMeta(key) { return reqP((await store('meta', 'readonly')).get(key)); }
  async function setMeta(key, value) { return reqP((await store('meta', 'readwrite')).put(value, key)); }

  // Stabile, einmalig erzeugte Geräte-ID (für eindeutige Bild-IDs srcId).
  async function getDeviceId() {
    let id = await getMeta('deviceId');
    if (!id) {
      id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      await setMeta('deviceId', id);
    }
    return id;
  }

  // ---- Migration v2 -> v3 (einmalig) ----
  function legacyExists(name) { return _db.objectStoreNames.contains(name); }
  async function legacyGet(name, key) {
    if (!legacyExists(name)) return undefined;
    return reqP(_db.transaction(name, 'readonly').objectStore(name).get(key));
  }
  async function legacyGetAll(name) {
    if (!legacyExists(name)) return [];
    return reqP(_db.transaction(name, 'readonly').objectStore(name).getAll());
  }

  async function migrateIfNeeded() {
    try {
      if (await getMeta('migratedV3')) return;

      const oldProject = await legacyGet('project', 'current');
      const oldStructure = await legacyGet('structure', 'current');
      const oldCustom = await legacyGetAll('customNames');
      const oldSelected = await legacyGet('meta', 'selectedTemplate'); // war früher in meta
      const allPhotos = await reqP((await store('photos', 'readonly')).getAll());
      const oldPhotos = allPhotos.filter((p) => !p.jobId);

      const hasOldData = !!oldProject || (oldStructure && oldStructure.length) ||
        (oldCustom && oldCustom.length) || oldPhotos.length > 0;

      if (hasOldData) {
        const id = 'job_' + Date.now();
        const h = oldProject || {};
        const job = {
          id,
          name: (h.filiale || 'Auftrag 1'),
          header: {
            filiale: h.filiale || '', ort: h.ort || '', datum: h.datum || '',
            beauftragung: h.beauftragung || 'NFK Vollverkabelung',
            techniker: h.techniker || [],
          },
          structure: oldStructure || [],
          customNames: oldCustom || [],
          selectedTemplate: oldSelected || null,
          priorCounts: {},
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        await reqP((await store('jobs', 'readwrite')).put(job));

        // Fotos dem Default-Auftrag zuordnen.
        if (oldPhotos.length) {
          const ps = await store('photos', 'readwrite');
          for (const p of oldPhotos) { p.jobId = id; await reqP(ps.put(p)); }
        }
        // Alte Bautagebuch-Tage übernehmen.
        const oldDiary = await legacyGetAll('diary');
        if (oldDiary.length) {
          const ds = await store('diary2', 'readwrite');
          for (const d of oldDiary) { d.jobId = id; await reqP(ds.put(d)); }
        }
        await setMeta('currentJobId', id);
      }
      await setMeta('migratedV3', true);
    } catch (e) {
      console.error('Migration fehlgeschlagen (Daten bleiben erhalten):', e);
    }
  }

  // ---- Aufträge ----
  async function listJobs() {
    const all = await reqP((await store('jobs', 'readonly')).getAll());
    return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  async function getJob(id) { return reqP((await store('jobs', 'readonly')).get(id)); }
  async function saveJob(job) {
    job.updatedAt = Date.now();
    await reqP((await store('jobs', 'readwrite')).put(job));
    return job;
  }
  function newJob(name, headerDefaults) {
    const now = Date.now();
    return {
      id: 'job_' + now + '_' + Math.random().toString(36).slice(2, 7),
      name: name || 'Neuer Auftrag',
      header: Object.assign(
        { filiale: '', ort: '', datum: new Date().toISOString().slice(0, 10), beauftragung: 'NFK Vollverkabelung', techniker: [] },
        headerDefaults || {}
      ),
      structure: [], customNames: [], selectedTemplate: null, priorCounts: {},
      skipped: { obers: [], unters: [], nodes: [] }, // „nicht benötigt"-Markierungen
      createdAt: now, updatedAt: now,
    };
  }
  async function createJob(name, headerDefaults) {
    const job = newJob(name, headerDefaults);
    await saveJob(job);
    return job;
  }
  async function deleteJob(id) {
    await reqP((await store('jobs', 'readwrite')).delete(id));
    // zugehörige Fotos löschen
    const ps = await store('photos', 'readwrite');
    await new Promise((resolve, reject) => {
      const cur = ps.index('byJob').openCursor(IDBKeyRange.only(id));
      cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } else resolve(); };
      cur.onerror = () => reject(cur.error);
    });
    // zugehörige Bautagebuch-Tage löschen
    const ds = await store('diary2', 'readwrite');
    await new Promise((resolve, reject) => {
      const range = IDBKeyRange.bound([id, ''], [id, '￿']);
      const cur = ds.openCursor(range);
      cur.onsuccess = () => { const c = cur.result; if (c) { c.delete(); c.continue(); } else resolve(); };
      cur.onerror = () => reject(cur.error);
    });
  }
  async function getCurrentJobId() { return getMeta('currentJobId'); }
  async function setCurrentJobId(id) { return setMeta('currentJobId', id); }

  // ---- Bilder (append-only, pro Auftrag) ----
  async function countPhotos(jobId, nodeKey) {
    const s = await store('photos', 'readonly');
    return reqP(s.index('byJobNode').count(IDBKeyRange.only([jobId, nodeKey])));
  }
  async function getPhotos(jobId, nodeKey) {
    const s = await store('photos', 'readonly');
    const all = await reqP(s.index('byJobNode').getAll(IDBKeyRange.only([jobId, nodeKey])));
    return all.sort((a, b) => a.seq - b.seq);
  }
  async function getAllPhotos(jobId) {
    const s = await store('photos', 'readonly');
    return reqP(s.index('byJob').getAll(IDBKeyRange.only(jobId)));
  }
  // Gehört das Bild zur Bilddokumentation? Vorprüfung ('__vorpruefung__<pid>') und
  // Baubehinderungsanzeige ('__behinderung__<id>') legen ihre Fotos unter reservierten
  // nodeKeys mit führendem '__' ab. Sie sind KEIN Teil des Bilddoku-ZIP und dürfen
  // deshalb auch nicht in Zählungen einfließen, die sich auf die Sicherung beziehen.
  function isBilddokuPhoto(rec) {
    return !(rec && typeof rec.nodeKey === 'string' && rec.nodeKey.indexOf('__') === 0);
  }
  // Nur die Bilder der Bilddokumentation eines Auftrags.
  async function getBilddokuPhotos(jobId) {
    return (await getAllPhotos(jobId)).filter(isBilddokuPhoto);
  }
  async function addPhoto(rec) {
    // rec: { jobId, nodeKey, seq, blob, createdAt, srcId }. Neue Bilder werden angehängt.
    return reqP((await store('photos', 'readwrite')).add(rec));
  }
  // Einzelnes Foto anhand seiner id löschen.
  // Bei Bilddoku-Positionen IMMER zusammen mit renumberNode() aufrufen (siehe dort),
  // sonst entstehen doppelte Bildnummern. Vorprüfungsfotos haben keine Nummerierung.
  async function deletePhotoById(id) {
    return reqP((await store('photos', 'readwrite')).delete(id));
  }
  // Nummeriert die Bilder einer Position lückenlos neu: prior+1 … prior+n
  // (Reihenfolge nach Aufnahmezeit, ersatzweise alter Nummer).
  // Nötig nach jedem Löschen, weil die nächste freie Nummer als prior+Anzahl+1
  // berechnet wird – ohne Neunummerierung gäbe es sonst zwei Bilder gleicher Nummer.
  async function renumberNode(jobId, nodeKey, prior) {
    const photos = await getPhotos(jobId, nodeKey);
    photos.sort((a, b) => (a.createdAt || a.seq || 0) - (b.createdAt || b.seq || 0));
    const changed = [];
    photos.forEach((p, i) => {
      const seq = (prior || 0) + i + 1;
      if (p.seq !== seq) { p.seq = seq; changed.push(p); }
    });
    if (!changed.length) return 0;
    const s = await store('photos', 'readwrite');
    for (const p of changed) await reqP(s.put(p));
    return changed.length;
  }
  // Aktualisiert einzelne Felder eines Fotos (z. B. caption) – nur für Vorprüfungsfotos.
  async function updatePhoto(rec) {
    return reqP((await store('photos', 'readwrite')).put(rec));
  }
  // Menge der bereits vorhandenen Bild-IDs eines Auftrags (für Duplikatschutz beim Merge).
  async function getPhotoSrcIds(jobId) {
    const all = await getAllPhotos(jobId);
    return new Set(all.map((p) => p.srcId).filter(Boolean));
  }

  // ---- Bautagebuch-Tage (pro Auftrag) ----
  async function getDiary(jobId, datum) {
    return reqP((await store('diary2', 'readonly')).get([jobId, datum]));
  }
  async function saveDiary(jobId, obj) {
    obj.jobId = jobId;
    return reqP((await store('diary2', 'readwrite')).put(obj));
  }
  async function deleteDiary(jobId, datum) {
    return reqP((await store('diary2', 'readwrite')).delete([jobId, datum]));
  }
  // Alle gespeicherten Bautagebuch-Tage eines Auftrags, neueste zuerst.
  async function listDiary(jobId) {
    const s = await store('diary2', 'readonly');
    const range = IDBKeyRange.bound([jobId, ''], [jobId, '￿']);
    const all = await reqP(s.getAll(range));
    return all.sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));
  }

  return {
    getMeta, setMeta, getDeviceId,
    listJobs, getJob, saveJob, createJob, deleteJob, newJob,
    getCurrentJobId, setCurrentJobId,
    countPhotos, getPhotos, getAllPhotos, getBilddokuPhotos, isBilddokuPhoto,
    addPhoto, deletePhotoById, renumberNode, updatePhoto, getPhotoSrcIds,
    getDiary, saveDiary, listDiary, deleteDiary,
  };
})();
