/* Sheet (ab v84.3) – Ein-/Ausblenden der Overlays und Wischen-zum-Schließen.
   Reine Darstellung: WAS beim Schließen passiert, entscheidet weiterhin der jeweilige
   Dialog. Ein Wisch nach unten löst nur den ✕-Knopf (#modalClose) aus – also genau den
   Weg „Abbrechen", den jeder Dialog dort selbst hinterlegt hat.

   Grundsätze (apple-design / animate):
   - Jede Bewegung startet am AKTUELLEN Bildschirmwert – Öffnen während des Schließens
     (und umgekehrt) kehrt ohne Sprung um, nichts sperrt die Eingabe.
   - Das Sheet folgt dem Finger 1:1, nach oben mit Gummiband-Widerstand.
   - Loslassen: Schwung wird hochgerechnet (Apples Projektion), danach Schließen oder
     Zurückfedern (kritisch gedämpft, übernimmt die Fingergeschwindigkeit).
   - „Bewegung reduzieren": keine Wege, nur kurze Überblendungen. */
const Sheet = (() => {
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';
  const DUR_AUF = 260, DUR_ZU = 200, DUR_FADE = 150;
  const kannAnimieren = (el) => el && typeof el.animate === 'function';

  const panelVon = (o) => o.querySelector('.modal, .photo-box');
  const istSheet = (p) => p && p.classList.contains('modal');

  // Abdunklung: Farbe aus dem CSS (Token --scrim) lesen und nur die Deckkraft skalieren.
  function scrimFarbe(o, anteil) {
    if (!o._scrim) {
      o.style.backgroundColor = '';
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(o).backgroundColor) || [];
      const t = (m[1] || '0,0,0,0.42').split(',').map((s) => parseFloat(s));
      o._scrim = { r: t[0], g: t[1], b: t[2], a: t.length > 3 ? t[3] : 1 };
    }
    const s = o._scrim;
    return `rgba(${s.r}, ${s.g}, ${s.b}, ${(s.a * Math.max(0, Math.min(1, anteil))).toFixed(3)})`;
  }

  // Aktuelle Lage einfrieren: laufende Animationen anhalten, Ist-Werte als Inline-Stil
  // übernehmen. Liefert { y, scale, opacity, bg } – davon startet die nächste Bewegung.
  function einfrieren(o) {
    const p = panelVon(o);
    const csP = getComputedStyle(p), csO = getComputedStyle(o);
    let y = 0, scale = 1;
    const tf = csP.transform;
    if (tf && tf !== 'none') {
      const m = tf.match(/matrix\(([^)]+)\)/);
      if (m) { const v = m[1].split(',').map(parseFloat); scale = v[0]; y = v[5]; }
    }
    const stand = { y, scale, opacity: parseFloat(csP.opacity), bg: csO.backgroundColor };
    [o, p].forEach((el) => el.getAnimations && el.getAnimations().forEach((a) => a.cancel()));
    p.style.transform = `translateY(${y}px) scale(${scale})`;
    p.style.opacity = String(stand.opacity);
    o.style.backgroundColor = stand.bg;
    return stand;
  }

  function aufraeumen(o) {
    const p = panelVon(o);
    p.style.transform = '';
    p.style.opacity = '';
    o.style.backgroundColor = '';
  }

  // Ende melden – auch wenn die App im Hintergrund war und die Animation ihr Ende nie meldet.
  function beiEnde(a, dauer, fertig) {
    let erledigt = false, abgebrochen = false;
    const ende = () => { if (!erledigt && !abgebrochen) { erledigt = true; fertig(); } };
    a.onfinish = ende;
    a.oncancel = () => { abgebrochen = true; };
    setTimeout(() => {
      if (a.playState === 'running') { try { a.finish(); } catch (e) { /* egal */ } }
      ende();
    }, dauer + 200);
  }

  // ------------------------------------------------------------ Öffnen / Schließen
  function zeigen(o, warVersteckt) {
    stoppeFeder(o);
    const p = panelVon(o);
    if (!kannAnimieren(p)) return;
    const sheet = istSheet(p);
    const h = p.offsetHeight || window.innerHeight;
    if (warVersteckt) o._scrim = null;      // Farbe neu lesen (Hell/Dunkel kann gewechselt haben)
    // Frisch geöffnet: von „ganz zu" aus. Noch im Schließen: vom aktuellen Stand aus.
    const von = warVersteckt
      ? { y: reduce.matches ? 0 : (sheet ? h : 0), scale: sheet || reduce.matches ? 1 : 0.97, opacity: sheet && !reduce.matches ? 1 : 0, bg: scrimFarbe(o, 0) }
      : einfrieren(o);
    const dauer = reduce.matches ? DUR_FADE : DUR_AUF;
    const kurve = reduce.matches ? 'ease' : (sheet ? EASE_DRAWER : EASE_OUT);
    const s = o.animate([{ backgroundColor: von.bg }, { backgroundColor: scrimFarbe(o, 1) }], { duration: dauer, easing: kurve });
    const a = p.animate([
      { transform: `translateY(${von.y}px) scale(${von.scale})`, opacity: von.opacity },
      { transform: 'translateY(0px) scale(1)', opacity: 1 },
    ], { duration: dauer, easing: kurve });
    aufraeumen(o);
    // Sicherheitsnetz: Im Hintergrund bleiben Animationen stehen – dann stünde das Sheet
    // unsichtbar am Startpunkt. Spätestens kurz nach der Dauer in den Endzustand.
    setTimeout(() => [s, a].forEach((x) => {
      if (x.playState === 'running') { try { x.finish(); } catch (e) { /* egal */ } }
    }), dauer + 200);
  }

  // fertig() läuft nur, wenn das Schließen nicht durch ein erneutes Öffnen abgelöst wurde.
  function verbergen(o, fertig) {
    stoppeFeder(o);
    const p = panelVon(o);
    if (!kannAnimieren(p)) { fertig(); return; }
    const sheet = istSheet(p);
    const von = einfrieren(o);
    const h = p.offsetHeight || window.innerHeight;
    const nach = reduce.matches
      ? { y: von.y, scale: von.scale, opacity: 0 }
      : (sheet ? { y: h, scale: 1, opacity: 1 } : { y: 0, scale: 0.97, opacity: 0 });
    const dauer = reduce.matches ? DUR_FADE : DUR_ZU;
    const kurve = reduce.matches ? 'ease' : EASE_OUT;
    const s = o.animate([{ backgroundColor: von.bg }, { backgroundColor: scrimFarbe(o, 0) }], { duration: dauer, easing: kurve, fill: 'forwards' });
    const a = p.animate([
      { transform: `translateY(${von.y}px) scale(${von.scale})`, opacity: von.opacity },
      { transform: `translateY(${nach.y}px) scale(${nach.scale})`, opacity: nach.opacity },
    ], { duration: dauer, easing: kurve, fill: 'forwards' });
    aufraeumen(o);
    beiEnde(a, dauer, () => {
      // Erst unsichtbar schalten, dann die festgehaltenen Endbilder lösen – sonst blitzt das
      // Sheet für einen Frame in Ruhelage auf.
      // Nur die EIGENEN Animationen lösen: fertig() kann direkt den nächsten Dialog öffnen.
      fertig();
      s.cancel();
      a.cancel();
    });
  }

  // ------------------------------------------------------------ Feder (Zurückschnellen)
  // Kritisch gedämpft (Dämpfung 1.0, Response 0.3 s): kein Überschwingen, übernimmt die
  // Geschwindigkeit des Fingers. x(t) = (x0 + (v0 + ω·x0)·t)·e^(−ω·t)
  function stoppeFeder(o) {
    if (o && o._feder) { cancelAnimationFrame(o._feder); o._feder = 0; }
  }
  function federZurueck(o, y0, v0, setze) {
    const w = 2 * Math.PI / 0.3;
    const t0 = performance.now();
    const schritt = (jetzt) => {
      const t = (jetzt - t0) / 1000;
      const e = Math.exp(-w * t);
      const y = (y0 + (v0 + w * y0) * t) * e;
      const v = (v0 - w * (v0 + w * y0) * t) * e;
      if (Math.abs(y) < 0.5 && Math.abs(v) < 10) { o._feder = 0; setze(0); aufraeumen(o); return; }
      setze(y);
      o._feder = requestAnimationFrame(schritt);
    };
    o._feder = requestAnimationFrame(schritt);
  }

  // ------------------------------------------------------------ Wischen zum Schließen
  // Gummiband oberhalb der Ruhelage: je weiter, desto zäher (apple-design §9).
  const gummiband = (ueber, dim, c = 0.55) => (ueber * dim * c) / (dim + c * Math.abs(ueber));
  // Apples Projektion: wo käme das Sheet mit dem aktuellen Schwung zur Ruhe?
  const projektion = (v, d = 0.998) => (v / 1000) * d / (1 - d);

  function wischenEinrichten() {
    const o = document.getElementById('modalOverlay');
    const p = o && o.querySelector('.modal');
    const griff = p && p.querySelector('.modal-head');
    if (!griff || !window.PointerEvent) return;

    let zug = null;   // { id, startY, basis, aktiv, verlauf: [{y, t}] }
    const setze = (y) => {
      const h = p.offsetHeight || 1;
      p.style.transform = `translateY(${y}px)`;
      o.style.backgroundColor = scrimFarbe(o, 1 - Math.max(0, y) / h);
    };

    griff.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button') || o.hidden) return;
      stoppeFeder(o);
      const stand = einfrieren(o);
      zug = { id: e.pointerId, startY: e.clientY, basis: stand.y, aktiv: false, verlauf: [{ y: stand.y, t: e.timeStamp }] };
      try { griff.setPointerCapture(e.pointerId); } catch (err) { /* ältere Browser */ }
    });

    griff.addEventListener('pointermove', (e) => {
      if (!zug || e.pointerId !== zug.id) return;
      const roh = zug.basis + (e.clientY - zug.startY);
      if (!zug.aktiv) {
        if (Math.abs(e.clientY - zug.startY) < 10) return;   // Schwelle: Tippen bleibt Tippen
        zug.aktiv = true;
      }
      const y = roh >= 0 ? roh : gummiband(roh, p.offsetHeight || window.innerHeight);
      setze(y);
      zug.verlauf.push({ y, t: e.timeStamp });
      if (zug.verlauf.length > 6) zug.verlauf.shift();
    });

    const loslassen = (e) => {
      if (!zug || e.pointerId !== zug.id) return;
      const z = zug;
      zug = null;
      try { griff.releasePointerCapture(e.pointerId); } catch (err) { /* egal */ }
      const letzt = z.verlauf[z.verlauf.length - 1];
      const y = letzt.y;
      if (!z.aktiv) {
        // Nur angetippt: aus dem eingefrorenen Stand normal weiter in die Ruhelage.
        if (Math.abs(y) > 0.5) federZurueck(o, y, 0, setze); else aufraeumen(o);
        return;
      }
      // Geschwindigkeit aus den letzten ~100 ms (px/s, positiv = nach unten).
      const ref = z.verlauf.find((x) => letzt.t - x.t <= 100) || z.verlauf[0];
      const dt = (letzt.t - ref.t) / 1000;
      const v = dt > 0 ? (letzt.y - ref.y) / dt : 0;
      const h = p.offsetHeight || window.innerHeight;
      const ziel = y + projektion(v);
      if (e.type !== 'pointercancel' && (ziel > h * 0.4 || (v > 800 && y > 0))) {
        // Schließen über den ✕-Knopf: derselbe Weg wie „Abbrechen" des jeweiligen Dialogs.
        document.getElementById('modalClose').click();
      } else if (reduce.matches) {
        aufraeumen(o);
      } else {
        federZurueck(o, y, v, setze);
      }
    };
    griff.addEventListener('pointerup', loslassen);
    griff.addEventListener('pointercancel', loslassen);
  }

  document.addEventListener('DOMContentLoaded', wischenEinrichten);

  return { zeigen, verbergen };
})();
