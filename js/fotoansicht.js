/* Fotoansicht (ab v84.4) – Großansicht der Bilddokumentation im Stil von iOS Fotos.
   Reine Darstellung und Gesten. WAS ein Bild ist und was „Löschen" bedeutet, liefert
   app.js (openPhotoViewer) – hier wird nichts gespeichert oder gelöscht.

   - Öffnet aus dem angetippten Vorschaubild und schließt in das Vorschaubild des gerade
     gezeigten Bilds zurück (FLIP: Lage, Größe und Zuschnitt hängen an EINER Feder).
   - Seitlich wischen blättert durch die Bilder derselben Position, nach unten wischen
     schließt, zwei Finger / Doppeltippen zoomen. Tippen blendet die Leisten aus/ein.
   - Alles folgt dem Finger 1:1, Loslassen übergibt die Fingergeschwindigkeit an eine Feder,
     jede laufende Bewegung lässt sich sofort wieder greifen (apple-design §2–§6).
   - „Bewegung reduzieren": kein Fliegen, kein Federn – kurze Überblendungen. */
const Fotoansicht = (() => {
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const EASE_OUT = Bewegung.EASE_OUT;                // = --ease in styles.css
  const LUECKE = 16;              // Abstand zwischen zwei Bildern beim Blättern
  const ZOOM_MAX = 4, ZOOM_DOPPEL = 2.5;

  let ov, hg, buehne, folien;         // DOM
  let opt = null;                     // { liste:[{photo,url,thumb}], index, beschriftung(b), loeschen(b) }
  let index = 0;
  let spurX = 0;                      // Versatz der Bildspur (Blättern)
  let zoom = { s: 1, tx: 0, ty: 0 };  // Zoom des aktuellen Bilds
  let zieh = { x: 0, y: 0 };          // Wisch-zum-Schließen-Versatz
  let flip = null;                    // { a, b, p } – Öffnen/Schließen
  let leisten = true;
  let schliesst = null;               // Promise des laufenden Schließens

  // ------------------------------------------------------------------ Feder
  // Analytische Lösung des gedämpften Federschwingers (Dämpfung ≤ 1), startet beim
  // aktuellen Wert mit der aktuellen Geschwindigkeit. response = Sekunden, ~Einschwingzeit.
  const federn = {};
  function feder(name, von, nach, v, cfg, setze, fertig) {
    stoppe(name);
    if (reduce.matches) { setze(nach); zeichnen(); if (fertig) fertig(); return; }
    const w0 = 2 * Math.PI / cfg.response, z = cfg.damping, x0 = von - nach;
    const eps = cfg.eps || 0.5;
    let t0 = null;
    const lage = (t) => {
      if (z >= 1) return (x0 + (v + w0 * x0) * t) * Math.exp(-w0 * t);
      const wd = w0 * Math.sqrt(1 - z * z);
      return Math.exp(-z * w0 * t) * (x0 * Math.cos(wd * t) + ((v + z * w0 * x0) / wd) * Math.sin(wd * t));
    };
    const schritt = (jetzt) => {
      if (t0 === null) t0 = jetzt;
      const t = (jetzt - t0) / 1000;
      const x = lage(t), xv = (lage(t + 0.004) - x) / 0.004;
      if (Math.abs(x) < eps && Math.abs(xv) < eps * 20) {
        delete federn[name];
        setze(nach); zeichnen();
        if (fertig) fertig();
        return;
      }
      setze(nach + x); zeichnen();
      federn[name] = requestAnimationFrame(schritt);
    };
    federn[name] = requestAnimationFrame(schritt);
  }
  function stoppe(name) {
    if (federn[name]) { cancelAnimationFrame(federn[name]); delete federn[name]; }
  }
  const stoppeAlle = () => Object.keys(federn).forEach(stoppe);

  // Gummiband: je weiter über die Grenze, desto zäher (apple-design §9).
  const rb = (ueber, dim, c = 0.55) => (ueber * dim * c) / (dim + c * Math.abs(ueber));
  const gummi = (wert, min, max, dim) =>
    wert < min ? min - rb(min - wert, dim) : wert > max ? max + rb(wert - max, dim) : wert;
  // Apples Projektion: wo käme die Bewegung mit diesem Schwung zur Ruhe?
  const projektion = (v, d = 0.998) => (v / 1000) * d / (1 - d);
  const klemme = (w, min, max) => Math.max(min, Math.min(max, w));

  // ------------------------------------------------------------------ Geometrie
  const W = () => window.innerWidth;
  const H = () => window.innerHeight;
  // Eingepasstes Bild (wie object-fit: contain) – Lage und Größe bei Zoom 1.
  function geo(img) {
    const nw = img.naturalWidth || W(), nh = img.naturalHeight || H();
    const s = Math.min(W() / nw, H() / nh);
    const w = nw * s, h = nh * s;
    return { w, h, x: (W() - w) / 2, y: (H() - h) / 2 };
  }
  // Zulässiger Verschiebe-Bereich bei Zoomstufe s.
  function grenzen(g, s) {
    const ws = g.w * s, hs = g.h * s;
    const ax = ws <= W() ? [(W() - ws) / 2 - g.x, (W() - ws) / 2 - g.x] : [W() - ws - g.x, -g.x];
    const ay = hs <= H() ? [(H() - hs) / 2 - g.y, (H() - hs) / 2 - g.y] : [H() - hs - g.y, -g.y];
    return { minX: ax[0], maxX: ax[1], minY: ay[0], maxY: ay[1] };
  }
  const cur = () => folien[1];

  // Lage („Pose") des aktuellen Bilds: links/oben/Skalierung, Zuschnitt, Hintergrund, Deckkraft.
  function normalPose() {
    const g = cur().g;
    const L0 = g.x + zoom.tx, T0 = g.y + zoom.ty, S0 = zoom.s;
    const unten = Math.max(zieh.y, 0);
    const k = 1 - Math.min(unten / H(), 1) * 0.25;        // beim Runterziehen leicht kleiner
    const cx = L0 + g.w * S0 / 2 + zieh.x, cy = T0 + g.h * S0 / 2 + zieh.y;
    const S = S0 * k;
    return { l: cx - g.w * S / 2, t: cy - g.h * S / 2, sc: S, ix: 0, iy: 0, bg: 1 - Math.min(unten / (H() * 0.6), 1), op: 1 };
  }
  // Pose, in der das Bild genau auf seinem Vorschaubild liegt (quadratisch zugeschnitten).
  function thumbPose(b, g) {
    const el = b && b.thumb && b.thumb.isConnected && b.thumb.querySelector('img');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > H()) return null;
    const sc = Math.max(r.width / g.w, r.height / g.h);
    return {
      l: r.left + r.width / 2 - g.w * sc / 2, t: r.top + r.height / 2 - g.h * sc / 2, sc,
      ix: Math.max(0, (g.w - r.width / sc) / 2), iy: Math.max(0, (g.h - r.height / sc) / 2), bg: 0, op: 1,
    };
  }
  const mische = (a, b, p) => {
    p = klemme(p, -0.15, 1.15);           // Überschwingen der Feder nie bis ins Absurde (Spiegeln)
    const m = {};
    for (const k of Object.keys(a)) m[k] = a[k] + (b[k] - a[k]) * p;
    m.ix = Math.max(0, m.ix); m.iy = Math.max(0, m.iy);
    m.bg = klemme(m.bg, 0, 1); m.op = klemme(m.op, 0, 1);
    return m;
  };
  const aktuellePose = () => (flip ? mische(flip.a, flip.b, flip.p) : normalPose());

  // ------------------------------------------------------------------ Zeichnen
  function setzePose(f, p) {
    if (!f.g) return;
    const s = f.img.style;
    s.width = f.g.w + 'px';
    s.height = f.g.h + 'px';
    s.transform = `translate3d(${p.l}px, ${p.t}px, 0) scale(${p.sc})`;
    s.clipPath = (p.ix > 0.5 || p.iy > 0.5) ? `inset(${p.iy}px ${p.ix}px ${p.iy}px ${p.ix}px round ${8 / p.sc}px)` : '';
    s.opacity = p.op == null ? '' : String(p.op);
  }
  function zeichnen() {
    if (!ov || ov.hidden) return;
    const abst = W() + LUECKE;
    folien.forEach((f, k) => {
      f.el.style.transform = `translate3d(${(k - 1) * abst + spurX}px, 0, 0)`;
      if (k !== 1 && f.g) setzePose(f, { l: f.g.x, t: f.g.y, sc: 1, ix: 0, iy: 0, op: 1 });
    });
    if (!cur().g) return;                 // aktuelles Bild noch nicht geladen / schon geschlossen
    const p = aktuellePose();
    setzePose(cur(), p);
    hg.style.opacity = String(p.bg);
    leistenDeckkraft(Math.max(0, Math.min(1, (p.bg - 0.5) * 2)));
  }

  // ------------------------------------------------------------------ Bilder belegen
  function bereit(img) {
    if (img.complete && img.naturalWidth) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, 600);
      img.onload = img.onerror = () => { clearTimeout(t); res(); };
    });
  }
  function belegen() {
    const l = opt.liste;
    [index - 1, index, index + 1].forEach((i, k) => {
      const f = folien[k];
      const b = l[i];
      f.el.hidden = !b;
      if (!b) { f.img.removeAttribute('src'); f.g = null; return; }
      if (f.img.getAttribute('src') !== b.url) f.img.src = b.url;
      f.g = f.img.naturalWidth ? geo(f.img) : null;
      bereit(f.img).then(() => { if (f.img.getAttribute('src') === b.url) { f.g = geo(f.img); zeichnen(); } });
    });
    const b = l[index];
    const txt = opt.beschriftung ? opt.beschriftung(b) : { titel: '', sub: '' };
    document.getElementById('photoTitle').textContent = txt.titel || '';
    document.getElementById('photoSub').textContent = txt.sub || '';
    document.getElementById('pvZaehler').textContent = l.length > 1 ? `${index + 1} von ${l.length}` : '';
    thumbsZeigen();
  }
  // Das Vorschaubild des gezeigten Bilds ist „unterwegs" in der Großansicht – wie bei iOS.
  function thumbsZeigen(alle) {
    if (!opt) return;
    opt.liste.forEach((b, i) => {
      const img = b.thumb && b.thumb.querySelector('img');
      if (img) img.style.visibility = (!alle && i === index) ? 'hidden' : '';
    });
  }

  // ------------------------------------------------------------------ Leisten
  // Beim Ziehen/Öffnen/Schließen folgt die Deckkraft der Leisten dem Bild – direkt an den
  // zwei Leisten gesetzt (nicht als Variable am ganzen Fenster, das zwang den Browser, alles
  // darunter neu zu berechnen) und ohne die 150-ms-Überblendung, die dem Finger nachhinkte.
  // Die Überblendung bleibt nur für das Ein-/Ausblenden per Tippen (v84.12).
  let leistenEls = [];
  let leistenWert = 1;
  function leistenDeckkraft(w) {
    w = Math.round(w * 100) / 100;
    if (w === leistenWert) return;
    leistenWert = w;
    leistenEls.forEach((el) => {
      el.style.transition = w < 1 ? 'none' : '';
      el.style.setProperty('--pv-l', String(w));
    });
  }
  function leistenSetzen(an) {
    leisten = an;
    ov.classList.toggle('pv-ohne-leisten', !an);
  }

  // ------------------------------------------------------------------ Öffnen / Schließen
  // ------------------------------------------------------------------ Zurück-Taste (v84.8)
  // Die Android-Zurück-Taste (und die Zurück-Geste) soll die Ansicht schließen wie das ✕.
  // Bis v84.7 ging sie an der Ansicht vorbei in den Verlauf der App: einmal drücken
  // wechselte die Seite dahinter, zweimal schloss die App. Darum legt das Öffnen einen
  // eigenen Verlaufseintrag an. Zurück nimmt ihn weg → app.js (popstate) fragt zuerst hier
  // nach (zurueckTaste). Schließt man per ✕/Wischen/Löschen, wird der Eintrag mit
  // history.back() wieder entfernt; das dadurch ausgelöste popstate wird ignoriert.
  let verlaufEintrag = false;        // unser Eintrag liegt oben im Verlauf
  let popIgnorieren = 0;             // so viele popstate-Ereignisse stammen von uns selbst
  function verlaufAnlegen() {
    if (verlaufEintrag) return;
    history.pushState(Object.assign({}, history.state, { foto: true }), '');
    verlaufEintrag = true;
  }
  function verlaufEntfernen() {
    if (!verlaufEintrag) return;
    verlaufEintrag = false;
    popIgnorieren++;
    history.back();
  }
  // Von app.js im popstate aufgerufen. true = das Ereignis gehörte der Fotoansicht.
  function zurueckTaste() {
    if (popIgnorieren) { popIgnorieren--; return true; }
    if (!verlaufEintrag) return false;
    verlaufEintrag = false;
    const dialog = document.getElementById('modalOverlay');
    if (dialog && !dialog.hidden) {
      // Liegt ein Dialog („Bild löschen?") darüber, schließt Zurück nur den Dialog.
      document.getElementById('modalCancel').click();
      verlaufAnlegen();
      return true;
    }
    schliessen();
    return true;
  }

  async function oeffnen(o) {
    init();
    if (schliesst) await schliesst;      // ein laufendes Schließen erst zu Ende bringen
    verlaufAnlegen();
    stoppeAlle();
    opt = o;
    index = klemme(o.index || 0, 0, o.liste.length - 1);
    spurX = 0; zoom = { s: 1, tx: 0, ty: 0 }; zieh = { x: 0, y: 0 }; flip = null;
    leistenSetzen(true);
    ov.hidden = false;
    hg.style.opacity = '0';
    belegen();
    await bereit(cur().img);
    cur().g = geo(cur().img);
    const tp = thumbPose(o.liste[index], cur().g);
    if (reduce.matches || !tp) {
      zeichnen();
      if (typeof ov.animate === 'function') ov.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduce.matches ? 150 : 200, easing: reduce.matches ? 'ease' : EASE_OUT });
      return;
    }
    flip = { a: tp, b: normalPose(), p: 0 };
    zeichnen();
    feder('flip', 0, 1, 0, { response: 0.4, damping: 0.9, eps: 0.001 }, (v) => { flip.p = v; }, () => { flip = null; zeichnen(); });
    // Sicherheitsnetz: Im Hintergrund läuft kein Bildaufbau – nicht im Vorschaubild hängen bleiben.
    setTimeout(() => { if (flip && !schliesst) { stoppe('flip'); flip = null; zeichnen(); } }, 1200);
  }

  // v = Fingergeschwindigkeit { x, y } (px/s) aus einem Wisch – wird an die Feder übergeben.
  function schliessen(v = { x: 0, y: 0 }) {
    if (!ov || ov.hidden) return Promise.resolve();
    if (schliesst) return schliesst;
    verlaufEntfernen();                  // ✕ / Wischen / Löschen: eigenen Verlaufseintrag wieder weg
    schliesst = new Promise((fertig) => {
      clearTimeout(tippTimer);
      const a = cur().g ? aktuellePose() : null;   // null: Bild noch nicht geladen → nur ausblenden
      stoppeAlle();
      flip = null;
      let erledigt = false;
      const ende = () => {
        if (erledigt) return;
        erledigt = true;
        stoppe('flip');
        ov.hidden = true;
        ov.style.opacity = '';
        thumbsZeigen(true);
        folien.forEach((f) => { f.img.removeAttribute('src'); f.img.removeAttribute('style'); f.g = null; });
        flip = null;
        schliesst = null;
        fertig();
      };
      if (reduce.matches || !a || typeof ov.animate !== 'function') {
        if (typeof ov.animate === 'function') {
          const an = ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: reduce.matches ? 'ease' : EASE_OUT, fill: 'forwards' });
          an.onfinish = () => { an.cancel(); ende(); };
          setTimeout(ende, 400);
        } else ende();
        return;
      }
      const g = cur().g;
      const tp = g && thumbPose(opt.liste[index], g);
      // Ohne sichtbares Vorschaubild: an Ort und Stelle kleiner werden und ausblenden.
      const ziel = tp || { ...a, sc: a.sc * 0.85, l: a.l + (g ? g.w * a.sc * 0.075 : 0), t: a.t + (g ? g.h * a.sc * 0.075 : 0), bg: 0, op: 0 };
      flip = { a, b: ziel, p: 0 };
      leistenSetzen(false);
      // Fingergeschwindigkeit auf den Weg zum Ziel projizieren (Bildmitte → Zielmitte):
      // Bewegt sich der Finger vom Vorschaubild WEG, bremst das die Feder, statt sie anzuschieben.
      const mitte = (q) => ({ x: q.l + (g ? g.w * q.sc / 2 : 0), y: q.t + (g ? g.h * q.sc / 2 : 0) });
      const ma = mitte(a), mb = mitte(ziel);
      const dx = mb.x - ma.x, dy = mb.y - ma.y;
      const d2 = Math.max(dx * dx + dy * dy, 60 * 60);
      const vp = klemme(((v.x || 0) * dx + (v.y || 0) * dy) / d2, -3, 3);
      feder('flip', 0, 1, vp, { response: 0.35, damping: tp ? 0.9 : 1, eps: 0.002 }, (p) => { flip.p = p; }, ende);
      setTimeout(ende, 1500);   // Sicherheitsnetz: im Hintergrund (kein Bildaufbau) trotzdem schließen
    });
    return schliesst;
  }

  // ------------------------------------------------------------------ Blättern
  function blaettern(richtung, v = 0) {
    const ziel = index + richtung;
    if (!opt || ziel < 0 || ziel >= opt.liste.length) { federZurueck(v); return; }
    const abst = W() + LUECKE;
    if (reduce.matches) {
      index = ziel; spurX = 0; zoom = { s: 1, tx: 0, ty: 0 };
      belegen(); zeichnen();
      if (typeof cur().img.animate === 'function') cur().img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease' });
      return;
    }
    feder('spur', spurX, -richtung * abst, v, { response: 0.35, damping: 1 }, (x) => { spurX = x; }, () => {
      index = ziel; spurX = 0; zoom = { s: 1, tx: 0, ty: 0 };
      // Bildquellen eine Folie weiterreichen – die Bilder sind schon dekodiert, kein Flackern.
      belegen(); zeichnen();
    });
  }
  function federZurueck(v = 0) {
    feder('spur', spurX, 0, v, { response: 0.35, damping: 1 }, (x) => { spurX = x; });
  }

  // ------------------------------------------------------------------ Zoom
  function zoomZu(s, ax, ay, v = { s: 0, x: 0, y: 0 }) {
    const g = cur().g;
    if (!g) return;
    // Punkt (ax, ay) am Bildschirm bleibt beim Zoomen an seiner Stelle.
    const px = (ax - g.x - zoom.tx) / zoom.s, py = (ay - g.y - zoom.ty) / zoom.s;
    const gr = grenzen(g, s);
    const tx = klemme(ax - g.x - px * s, gr.minX, gr.maxX);
    const ty = klemme(ay - g.y - py * s, gr.minY, gr.maxY);
    const cfg = { response: 0.3, damping: 1, eps: 0.3 };
    feder('zs', zoom.s, s, v.s, { ...cfg, eps: 0.002 }, (w) => { zoom.s = w; });
    feder('zx', zoom.tx, tx, v.x, cfg, (w) => { zoom.tx = w; });
    feder('zy', zoom.ty, ty, v.y, cfg, (w) => { zoom.ty = w; });
  }
  // Nach Pinch/Verschieben: Zoomstufe und Lage in die Grenzen federn.
  function zoomEinrasten(vx = 0, vy = 0) {
    const g = cur().g;
    if (!g) return;
    if (zoom.s < 1.01) { zoomZu(1, W() / 2, H() / 2); return; }
    if (zoom.s > ZOOM_MAX) { zoomZu(ZOOM_MAX, W() / 2, H() / 2); return; }
    const gr = grenzen(g, zoom.s);
    const zx = klemme(zoom.tx + projektion(vx, 0.995), gr.minX, gr.maxX);
    const zy = klemme(zoom.ty + projektion(vy, 0.995), gr.minY, gr.maxY);
    feder('zx', zoom.tx, zx, vx, { response: 0.4, damping: 1, eps: 0.3 }, (w) => { zoom.tx = w; });
    feder('zy', zoom.ty, zy, vy, { response: 0.4, damping: 1, eps: 0.3 }, (w) => { zoom.ty = w; });
  }

  // ------------------------------------------------------------------ Gesten
  const zeiger = new Map();
  let modus = null;        // null | 'blaettern' | 'schliessen' | 'pan' | 'pinch'
  let start = null;        // { x, y, spurX, zoom, zieh }
  let verlauf = [];
  let pinch = null;
  let mehrfinger = false;   // war an dieser Berührung mehr als ein Finger beteiligt? (dann kein Tippen)
  let letzterTipp = null, tippTimer = 0;

  const geschwindigkeit = () => {
    if (verlauf.length < 2) return { x: 0, y: 0 };
    const l = verlauf[verlauf.length - 1];
    const r = verlauf.find((e) => l.t - e.t <= 100) || verlauf[0];
    const dt = (l.t - r.t) / 1000;
    // Auf reale Fingertempo begrenzen – Ausreißer (ein Sprung in einem Ereignis) ließen die
    // Feder sonst weit über das Ziel schießen.
    const max = 4000;
    return dt > 0
      ? { x: klemme((l.x - r.x) / dt, -max, max), y: klemme((l.y - r.y) / dt, -max, max) }
      : { x: 0, y: 0 };
  };
  function neuerStart(x, y, t) {
    start = { x, y, spurX, zoom: { ...zoom }, zieh: { ...zieh } };
    verlauf = [{ x, y, t }];
  }
  function pinchStart() {
    const [a, b] = [...zeiger.values()];
    const g = cur().g;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = {
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: zoom.s,
      px: (m.x - g.x - zoom.tx) / zoom.s, py: (m.y - g.y - zoom.ty) / zoom.s,
    };
    modus = 'pinch';
    if (spurX) federZurueck();
    if (zieh.x || zieh.y) { zieh = { x: 0, y: 0 }; }
  }

  function unten(e) {
    if (e.button > 0 || schliesst) return;
    if (flip) { stoppe('flip'); flip = null; }        // Öffnen noch im Flug: sofort fertig, dann greifen
    ['spur', 'zs', 'zx', 'zy', 'dx', 'dy'].forEach(stoppe);
    try { buehne.setPointerCapture(e.pointerId); } catch (err) { /* ältere Browser */ }
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (zeiger.size === 1) { modus = null; mehrfinger = false; neuerStart(e.clientX, e.clientY, e.timeStamp); }
    else { mehrfinger = true; if (zeiger.size === 2 && cur().g) pinchStart(); }
    zeichnen();
  }

  function bewegen(e) {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = cur().g;
    if (!g) return;
    if (modus === 'pinch' && zeiger.size >= 2) {
      const [a, b] = [...zeiger.values()];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let s = pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0;
      if (s > ZOOM_MAX) s = ZOOM_MAX * (1 + (s / ZOOM_MAX - 1) * 0.3);
      if (s < 1) s = 1 - (1 - s) * 0.45;
      zoom.s = s;
      zoom.tx = m.x - g.x - pinch.px * s;
      zoom.ty = m.y - g.y - pinch.py * s;
      zeichnen();
      return;
    }
    if (zeiger.size !== 1 || !start) return;
    let dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!modus) {
      if (Math.hypot(dx, dy) < 10) return;                     // Hysterese: Tippen bleibt Tippen
      modus = zoom.s > 1.01 ? 'pan' : (Math.abs(dx) > Math.abs(dy) ? 'blaettern' : 'schliessen');
      if (modus === 'schliessen' || modus === 'blaettern') clearTimeout(tippTimer);
      // Ab hier 1:1, ohne Sprung: Der Start rückt nur um die Schwelle nach – was der Finger
      // darüber hinaus schon zurückgelegt hat, zählt (wichtig bei groben Ereignisfolgen).
      const len = Math.hypot(dx, dy);
      start.x += dx / len * 10;
      start.y += dy / len * 10;
      dx = e.clientX - start.x; dy = e.clientY - start.y;
      if (modus === 'schliessen') leistenSetzen(false);
    }
    verlauf.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (verlauf.length > 6) verlauf.shift();
    if (modus === 'blaettern') {
      const abst = W() + LUECKE;
      const min = index >= opt.liste.length - 1 ? 0 : -abst;
      const max = index <= 0 ? 0 : abst;
      spurX = gummi(start.spurX + dx, min, max, W());
    } else if (modus === 'schliessen') {
      zieh.x = start.zieh.x + dx;
      const y = start.zieh.y + dy;
      zieh.y = y >= 0 ? y : -rb(-y, H());
    } else if (modus === 'pan') {
      const gr = grenzen(g, zoom.s);
      zoom.tx = gummi(start.zoom.tx + dx, gr.minX, gr.maxX, W());
      zoom.ty = gummi(start.zoom.ty + dy, gr.minY, gr.maxY, H());
    }
    zeichnen();
  }

  function hoch(e) {
    if (!zeiger.has(e.pointerId)) return;
    zeiger.delete(e.pointerId);
    try { buehne.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
    const abbruch = e.type === 'pointercancel';
    if (modus === 'pinch') {
      if (zeiger.size === 1) {
        // Ein Finger bleibt liegen: ab hier normales Verschieben.
        const [r] = [...zeiger.values()];
        modus = null; neuerStart(r.x, r.y, e.timeStamp);
      } else if (zeiger.size === 0) {
        modus = null;
      }
      zoomEinrasten();
      return;
    }
    if (zeiger.size > 0) return;
    const v = geschwindigkeit();
    const m = modus;
    modus = null;
    if (!m) { if (!abbruch && !mehrfinger) tippen(e.clientX, e.clientY, e.timeStamp); return; }
    if (m === 'blaettern') {
      const abst = W() + LUECKE;
      const ziel = spurX + projektion(v.x);
      let r = ziel < -abst / 2 ? 1 : ziel > abst / 2 ? -1 : 0;
      if (!r && Math.abs(v.x) > 500 && Math.sign(v.x) === Math.sign(spurX)) r = v.x < 0 ? 1 : -1;
      if (abbruch) r = 0;
      if (r) blaettern(r, v.x); else federZurueck(v.x);
    } else if (m === 'schliessen') {
      const ziel = zieh.y + projektion(v.y);
      if (!abbruch && zieh.y > 0 && (ziel > 120 || v.y > 800)) { schliessen(v); return; }
      leistenSetzen(true);
      const cfg = { response: 0.35, damping: 1 };
      feder('dx', zieh.x, 0, v.x, cfg, (w) => { zieh.x = w; });
      feder('dy', zieh.y, 0, v.y, cfg, (w) => { zieh.y = w; });
    } else if (m === 'pan') {
      zoomEinrasten(v.x, v.y);
    }
  }

  // Einzeltippen blendet die Leisten um – erst nach 250 ms, denn es könnte ein Doppeltippen
  // werden (nur hier wird diese Wartezeit bezahlt).
  function tippen(x, y, t) {
    if (letzterTipp && t - letzterTipp.t < 300 && Math.hypot(x - letzterTipp.x, y - letzterTipp.y) < 30) {
      clearTimeout(tippTimer);
      letzterTipp = null;
      if (zoom.s > 1.01) zoomZu(1, x, y);
      else zoomZu(ZOOM_DOPPEL, x, y);
      return;
    }
    letzterTipp = { x, y, t };
    clearTimeout(tippTimer);
    tippTimer = setTimeout(() => { letzterTipp = null; leistenSetzen(!leisten); }, 250);
  }

  // ------------------------------------------------------------------ Einrichten
  let eingerichtet = false;
  function init() {
    if (eingerichtet) return;
    eingerichtet = true;
    ov = document.getElementById('photoOverlay');
    hg = ov.querySelector('.pv-hg');
    leistenEls = [...ov.querySelectorAll('.pv-leiste')];
    buehne = ov.querySelector('.pv-buehne');
    folien = [...buehne.querySelectorAll('.pv-folie')].map((el) => ({ el, img: el.querySelector('img'), g: null }));
    if (window.PointerEvent) {
      buehne.addEventListener('pointerdown', unten);
      buehne.addEventListener('pointermove', bewegen);
      buehne.addEventListener('pointerup', hoch);
      buehne.addEventListener('pointercancel', hoch);
    }
    document.getElementById('photoClose').addEventListener('click', () => schliessen());
    document.getElementById('photoDelete').addEventListener('click', () => {
      if (opt && opt.loeschen) opt.loeschen(opt.liste[index]);
    });
    // Am Rechner: Pfeiltasten blättern, Esc schließt (nicht, solange ein Dialog darüber liegt).
    document.addEventListener('keydown', (e) => {
      if (ov.hidden || schliesst || !document.getElementById('modalOverlay').hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); schliessen(); }
      else if (e.key === 'ArrowRight' && zoom.s <= 1.01) { e.preventDefault(); blaettern(1); }
      else if (e.key === 'ArrowLeft' && zoom.s <= 1.01) { e.preventDefault(); blaettern(-1); }
    });
    // Drehen/Fenstergröße: neu einpassen, Zoom zurück.
    window.addEventListener('resize', () => {
      if (ov.hidden) return;
      stoppeAlle(); spurX = 0; zoom = { s: 1, tx: 0, ty: 0 }; zieh = { x: 0, y: 0 }; flip = null;
      folien.forEach((f) => { if (f.img.naturalWidth) f.g = geo(f.img); });
      zeichnen();
    });
  }

  return { oeffnen, schliessen, zurueckTaste };
})();
