/* textkorrektur.js – regelbasierte Korrektur der Bautagebuch-Texte (ohne KI, offline).
   Alle fachlichen Inhalte (Begriffe, Tippfehler, Standardsätze, AVL-Muster) stehen in
   textregeln.js; hier liegt nur die Verarbeitung.

   Grundsätze (BautagebuchFormatter/Specification.md §30, §69, §88):
   - Es werden keine Tätigkeiten, Ursachen oder Mengen erfunden.
   - Zeilen, die keine Regel eindeutig trifft, werden nur sprachlich bereinigt
     (Schreibweisen, Zahlen, Satzzeichen) und nicht umformuliert.
   - Gleiche Eingabe ergibt immer dieselbe Ausgabe.

   Verarbeitung je Feld: Zeilen zerlegen -> Spiegelstriche/„Punkt 1 –" entfernen ->
   Fortsetzungszeilen von Listen zusammenführen -> je Zeile Tippfehler, Begriffe, Zahlen,
   Datum -> Standardsatz, falls eine Tätigkeitsregel passt -> Satzbau (groß/Punkt).
   Im Feld Behinderungen werden AVL-Angaben erkannt und als eigene Zeile darunter gesetzt.

   Ergebnis: { text, regeln:[Bezeichnung], hinweise:[Text], freieZeilen:Anzahl }
*/
const Textkorrektur = (() => {
  const R = TEXTREGELN;
  const BUCHST = '\\p{L}';
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lc = (s) => s.toLocaleLowerCase('de-DE');
  const ersterGross = (s) => s.charAt(0).toLocaleUpperCase('de-DE') + s.slice(1);

  // Ein Regex für eine ganze Wortliste: längste Einträge zuerst, damit „vocovo headset"
  // vor „vocovo" greift; jedes Wort nur einmal ersetzt (kein Ketteneffekt).
  function wortlistenRegex(keys) {
    const sorted = keys.slice().sort((a, b) => b.length - a.length);
    const alt = sorted.map((k) => esc(k).replace(/ /g, '\\s+')).join('|');
    return new RegExp(`(?<![${BUCHST}\\d])(?:${alt})(?![${BUCHST}\\d])`, 'giu');
  }
  const wortlistenErsatz = (map) => {
    const re = wortlistenRegex(Object.keys(map));
    return (s) => s.replace(re, (m) => map[lc(m).replace(/\s+/g, ' ')] ?? m);
  };

  const ersetzeTippfehler = wortlistenErsatz(R.tippfehler);
  const ersetzeBegriffe = wortlistenErsatz(R.begriffe);
  const regexRegeln = R.regex.map(([q, z]) => [new RegExp(q, 'giu'), z]);
  const praefixRe = R.praefixe.map((q) => new RegExp(q, 'iu'));
  const nummernRe = new RegExp(`(?<![${BUCHST}])(${R.nummernPraefixe.map(esc).join('|')})(?=\\d)`, 'giu');
  const nummernKanon = Object.fromEntries(R.nummernPraefixe.map((p) => [lc(p), p]));
  const avlRe = R.avl.muster.map((q) => new RegExp(q, 'giu'));
  const avlMinRe = R.avl.musterMinuten.map((q) => new RegExp(q, 'giu'));
  const avlOhneStundenRe = new RegExp(R.avl.ohneStunden, 'iu');
  const bbaRe = new RegExp(R.bbaVerweis, 'giu');
  const hinweisRe = R.hinweise.map((h) => ({ re: new RegExp(h.muster, 'iu'), text: h.text }));

  // Zeilen mit gebeugtem Verb sind schon Sätze -> nicht in eine Vorlage pressen.
  const finitRe = new RegExp(`(?<![${BUCHST}])(wurde|wurden|war|waren|ist|sind|hat|haben|hatte|hatten|`
    + `konnte|konnten|musste|mussten|soll|sollen|sollte|wird|werden|kann|können|gab|kam|steht|stehen|`
    + `stand|fehlt|fehlen|befand|befinden|traten|zeigten|ließ|ließen|ging|gingen|lief|liefen|`
    + `da|weil|dass|sodass)(?![${BUCHST}])`, 'iu');

  const ueberschriften = new Set((R.ueberschriften || []).map(lc));
  const festeZeilen = new Map();
  R.festeZeilen.forEach((f) => f.zeilen.forEach((z) => festeZeilen.set(z, f.satz)));

  // Satzenden, die die Korrektur selbst erzeugt – eine Zeile, die so endet, ist schon fertig.
  // Statuswörter („begonnen", „abgeschlossen" …) fehlen bewusst: die trennt statusAbtrennen sauber ab.
  const fertigeEnden = new Set(['durchgeführt', 'erstellt', 'gehalten',
    ...Object.values(R.partizipien).map((p) => p.split(' ').pop())]);
  R.festeZeilen.forEach((f) => fertigeEnden.add(f.satz.replace(/\.$/, '').split(' ').pop()));
  Object.keys(R.status).forEach((s) => fertigeEnden.delete(s));
  const fertigRe = new RegExp(`(?<![\\p{L}])(${[...fertigeEnden].map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'iu');

  const aktionsMap = new Map();
  R.aktionen.forEach((a) => a.eingabe.forEach((e) => aktionsMap.set(e, a)));
  const aktAlt = [...aktionsMap.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const statusAlt = Object.keys(R.status).map(esc).join('|');
  const aktionKopfRe = new RegExp(`^((?:${aktAlt})(?:\\s*(?:,|und|\\+|&)\\s*(?:${aktAlt}))*)(?![${BUCHST}])(.*)$`, 'iu');
  // „Kabel Küche endverlegen" – zwischen Objekt und Tätigkeit höchstens ein kurzes Stück ohne Komma
  const leitObjektRe = new RegExp(`^(Kabel|Datenleitungen|Transferkabel)\\s+([^,]{0,30}?)\\s*(?<![${BUCHST}])(${aktAlt})(?![${BUCHST}])\\s*([^,]*)$`, 'iu');
  const statusEndeRe = new RegExp(`\\s+(?:(komplett|vollständig)\\s+)?(${statusAlt})$`, 'iu');
  const vollstaendigEndeRe = /\s+(komplett|vollständig)$/iu;
  const hauptwortRe = new RegExp(`^(${R.hauptwoerter.map(esc).join('|')})(?![${BUCHST}])\\s*(.*)$`, 'iu');
  const genitivKeys = Object.keys(R.genitiv).sort((a, b) => b.length - a.length);
  const aktionsObjektKeys = Object.keys(R.aktionsObjekte).sort((a, b) => b.length - a.length);
  const ohneZusatz = new Set(R.hauptwoerterOhneZusatz.map(lc));
  const listenEintraege = R.listenEintraege;
  const artikelRe = /^(der|des|den|dem|die|das|von|vom|aller|sämtlicher|im|in|am|an|zur|zum|für|mit)\s/iu;
  const ab = R.abstimmung;
  const abstRe = new RegExp(`^(${ab.eingabe.map(esc).join('|')})(?:\\s+mit)?\\s+(.+?)\\s+(?:${ab.praeposition.map(esc).join('|')})\\s+(.+)$`, 'iu');
  const abstDaRe = new RegExp(`^(${ab.eingabe.map(esc).join('|')})\\s+mit\\s+(.+?),?\\s+(${ab.begruendung.map(esc).join('|')})\\s+(.+)$`, 'iu');

  // ---------------- Normalisierung einer Zeile ----------------
  function zahlen(s) {
    // Kurzliste „AP5,6,7,10,11" / „Ap 1,2,8,9" -> „AP 5, AP 6, …" (wird später gruppiert)
    // „…, 12/vocovo 1" – Schrägstrich zwischen Nummer und neuem Begriff trennt zwei Einträge
    s = s.replace(/(\d)\s*\/\s*(?=\p{L})/gu, '$1, ');
    s = s.replace(/(?<![\p{L}])AP\s*(\d+(?:\s*[,/]\s*\d+)+)(?![\d.])/giu,
      (m, liste) => liste.split(/\s*[,/]\s*/).map((n) => 'AP ' + n).join(', '));
    s = s.replace(nummernRe, (m) => (nummernKanon[lc(m)] || m) + ' ');
    // „1+2", „1 u.2", „3/4", „1 & 2" -> „1 und 2" (nicht innerhalb von Bereichen wie 1-2+3-4)
    s = s.replace(/(?<![-–]\s*)(?<!\d|\d[.,])(\d+)\s*(?:\+|&|\/|u\.?|und\.?)\s*(\d+)(?!\d|[.,]\d)(?!\s*[-–]\s*\d)/giu, '$1 und $2');
    // „1-5" -> „1 bis 5", „3-4" -> „3 und 4" (zwei aufeinanderfolgende Nummern)
    s = s.replace(/(?<!\d|\d[.,:/])(\d{1,3})\s*[-–]\s*(\d{1,3})(?!\d|[.,:]\d)/g, (m, a, b) => {
      a = +a; b = +b;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return hi - lo === 1 ? `${lo} und ${hi}` : `${lo} bis ${hi}`;
    });
    // Datum „23.09 2026" / „23.9.2026" -> „23.09.2026"
    s = s.replace(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.?\s?(\d{4})(?!\d)/g,
      (m, d, mo, y) => `${d.padStart(2, '0')}.${mo.padStart(2, '0')}.${y}`);
    // Uhrzeit „12.30 Uhr" -> „12:30 Uhr"
    s = s.replace(/(?<![\d.])(\d{1,2})\.(\d{2})(\s*Uhr)/g, '$1:$2$3');
    return s;
  }

  function satzzeichen(s) {
    s = s.replace(/[ \t ]+/g, ' ').trim();
    s = s.replace(/\(\s+/g, '(').replace(/\s+([,.;:!?)])/g, '$1');
    s = s.replace(/([,;])(?=[^\s\d])/g, '$1 ');
    s = s.replace(/([,;])(?=\d)(?<=\p{L}[,;])/gu, '$1 ');
    s = s.replace(/(\p{Ll}{2,})\.(?=\p{Lu})/gu, '$1. ');
    // „Thin Client.des weiteren" / „sozialbereich.kein" -> Leerzeichen nach dem Punkt
    s = s.replace(/(\p{L}{4,})\.(?=\p{Ll}{3,})/gu, '$1. ');
    s = s.replace(/(?<![\p{L}])und\.(?=\s|\d)/gu, 'und ');
    s = s.replace(/(\p{L}):(?=\p{L})/gu, '$1: ');
    s = s.replace(/[,;:\s]+$/u, '');
    return s;
  }

  function normalisiere(s) {
    s = satzzeichen(s);
    s = ersetzeTippfehler(s);
    s = ersetzeBegriffe(s);
    for (const [re, z] of regexRegeln) s = s.replace(re, z);
    s = zahlen(s);
    return satzzeichen(s);
  }

  // „a, b, c" -> „a, b sowie c"; „+" zwischen Wörtern wird zum Komma.
  function liste(s) {
    s = s.replace(/\s*\+\s*/g, ', ').replace(/^[:\s]+|[,.\s]+$/g, '');
    s = s.replace(/^\((.*)\)$/, '$1');
    let teile = s.split(/,\s*/).filter(Boolean).map((t) => {
      const key = lc(t).replace(/\s+/g, ' ');
      return listenEintraege[key] || t;
    });
    // Nackte Nummern gehören zum Eintrag davor: „VoCoVo 1", „2", „3" -> „VoCoVo 1, 2 und 3"
    const gruppen = [];
    for (const t of teile) {
      const vorher = gruppen[gruppen.length - 1];
      if (/^\d+$/.test(t) && vorher && vorher.nummern) { vorher.nummern.push(t); continue; }
      const m = t.match(/^(.*\D)\s(\d+)$/u);
      gruppen.push(m && !/^AP$/i.test(m[1]) ? { name: m[1], nummern: [m[2]] } : { text: t });
    }
    teile = gruppen.map((g) => (g.text != null ? g.text
      : `${g.name} ${g.nummern.length > 1 ? undListe(g.nummern) : g.nummern[0]}`));
    // Hat der Techniker selbst schon „sowie"/„und" vor dem letzten Eintrag gesetzt, bleibt es dabei.
    const eigenesSowie = teile.length > 1
      && (teile.some((t) => /\ssowie\s/iu.test(t)) || /(?<!\d)\sund\s(?!\d)/iu.test(teile[teile.length - 1]));
    if (R.apGruppieren) teile = apGruppe(teile);
    if (teile.length < 2) return teile.join('');
    if (eigenesSowie) return teile.join(', ');
    return teile.slice(0, -1).join(', ') + ' sowie ' + teile[teile.length - 1];
  }

  // „AP 3", „AP 9", „AP 10" in einer Liste -> ein Eintrag „Access Points (AP) 3, 9 und 10"
  // an der Stelle des ersten AP (Stil der neueren Bautagebücher).
  const undListe = (n) => (n.length > 1 ? n.slice(0, -1).join(', ') + ' und ' + n[n.length - 1] : String(n[0]));
  function apGruppe(teile) {
    const nummern = [];
    let erste = -1;
    teile.forEach((t, i) => {
      const m = t.match(/^AP (\d+)(?: und (\d+))?$/u);
      if (m) { nummern.push(+m[1]); if (m[2]) nummern.push(+m[2]); if (erste < 0) erste = i; }
    });
    if (!nummern.length) return teile;
    nummern.sort((a, b) => a - b);
    // Ein einzelner AP bleibt „AP n" – ausgeschrieben wird er nur bei der ersten Nennung im Feld.
    const gruppe = nummern.length > 1 ? `Access Points (AP) ${undListe(nummern)}` : `AP ${nummern[0]}`;
    return teile.flatMap((t, i) => (i === erste ? [gruppe] : /^AP \d+(?: und \d+)?$/u.test(t) ? [] : [t]));
  }
  const plusAlsSowie = (s) => (/(?<!\d)\s*\+\s*(?!\d)/u.test(s) ? liste(s) : s);

  function genitiv(obj) {
    if (!obj || artikelRe.test(obj)) return obj;
    const o = lc(obj);
    for (const k of genitivKeys) {
      if (o === k || o.startsWith(k + ' ')) return R.genitiv[k] + obj.slice(k.length);
    }
    return obj;
  }

  // Genitiv-Objekt zurück in den Nominativ: „der PZE" -> „PZE", „des Headsetkanals" ->
  // „Headsetkanal", „aller Steigetrassen" -> „Sämtliche Steigetrassen", „von Brüstungskanal" -> „Brüstungskanal".
  function nominativ(obj) {
    if (/^(aller|sämtlicher)\s+/iu.test(obj)) return obj.replace(/^\S+\s+/u, 'Sämtliche ');
    if (/^(der|von)\s+/iu.test(obj)) return obj.replace(/^\S+\s+/u, '');
    const m = obj.match(/^des\s+(\S+)(.*)$/iu);
    if (m) {
      // Genitiv-Endung „-s"/„-es" entfernen („Headsetkanals", „Kabelweges"); Abkürzungen bleiben
      const wort = /\p{Ll}{2,}s$/u.test(m[1]) ? m[1].replace(/e?s$/u, '') : m[1];
      return wort + m[2];
    }
    return obj;
  }

  function statusAbtrennen(rest) {
    let status = null; let vollst = '';
    const m = rest.match(statusEndeRe);
    if (m) {
      rest = rest.slice(0, m.index);
      status = R.status[lc(m[2])];
      if (m[1]) vollst = 'vollständig ';
    } else {
      const v = rest.match(vollstaendigEndeRe);
      if (v) { rest = rest.slice(0, v.index); vollst = 'vollständig '; }
    }
    return { rest: rest.trim(), status: vollst + (status || 'durchgeführt') };
  }

  // ---------------- Vorlagen (Standardsätze) ----------------
  function vorlageAktion(zeile) {
    let kopf; let rest; let objekt = null;
    const lo = zeile.match(leitObjektRe);
    const m = zeile.match(aktionKopfRe);
    if (m) { kopf = m[1]; rest = m[2]; } else if (lo) {
      kopf = lo[3]; rest = (lo[2] + ' ' + lo[4]).trim();
      const o = lc(lo[1]);
      objekt = o === 'transferkabel' ? 'der Transferkabel' : 'der Datenleitungen';
    } else return null;

    const woerter = kopf.split(/\s*(?:,|und|\+|&)\s*/iu).filter(Boolean);
    const aktionen = woerter.map((w) => aktionsMap.get(lc(w)));
    if (aktionen.some((a) => !a)) return null;
    const nomen = [...new Set(aktionen.map((a) => a.nomen))];
    const nomenText = nomen.length > 1 ? nomen.slice(0, -1).join(', ') + ' und ' + nomen[nomen.length - 1] : nomen[0];
    objekt = objekt || aktionen[0].objekt;

    const st = statusAbtrennen(rest.trim());
    rest = st.rest;
    // Objektwort des Technikers entfernen („der Kabel", „von Datenleitungen" …)
    let eingeleitet = false;
    for (const o of aktionsObjektKeys) {
      const re = new RegExp(`^${esc(o)}(?![${BUCHST}])`, 'iu');
      if (re.test(rest)) {
        rest = rest.replace(re, '').trim();
        if (R.aktionsObjekte[o]) objekt = R.aktionsObjekte[o];
        eingeleitet = true;
        break;
      }
    }
    if (/^(?:für|von|:)(?![\p{L}])/iu.test(rest)) eingeleitet = true;
    rest = rest.replace(/^(?:für|von|:)(?![\p{L}])\s*/iu, '').replace(/^:\s*/, '').trim();

    if (!rest) return `${nomenText} ${objekt} ${st.status}.`;
    // Ortsangabe statt Liste: „Endverlegung aller Kabel in den Serverraum"
    if (!/^(?:für)/iu.test(rest) && /^(in|im|bis|an|auf|vom|zum|zur)\s/iu.test(rest)) {
      return `${nomenText} ${objekt} ${rest} ${st.status}.`;
    }
    // „Ausbau der Access Points (AP) im Verkaufsbereich" – eigener Artikel: unverändert übernehmen
    if (!eingeleitet && /^(der|die|des|den|dem|das)\s/iu.test(rest)) return `${nomenText} ${plusAlsSowie(rest)} ${st.status}.`;

    // Bereich vor der Liste: „Verkaufsbereich: AP 2, AP 8"
    let bereich = '';
    const b = rest.match(/^([\p{L}-]+)\s*:\s*(.+)$/u);
    if (b && R.bereiche[lc(b[1])]) { bereich = R.bereiche[lc(b[1])] + ' '; rest = b[2]; }
    // Nur ein Bereich als Ziel: „Kabelzug Kassenbereich" -> „… im Kassenbereich"
    if (!bereich && R.bereiche[lc(rest)]) return `${nomenText} ${objekt} ${R.bereiche[lc(rest)]} ${st.status}.`;
    return `${nomenText} ${objekt} ${bereich}für ${liste(rest)} ${st.status}.`;
  }

  // „Elektriker und PLB" -> „dem Elektriker und dem PLB"
  // „GU, FlexPos und WdW" -> „dem Generalunternehmer (GU), FlexPos und WdW"
  const personen = (s) => {
    const teile = s.split(/\s*,\s*|\s+und\s+/iu).map((p) => ab.personen[lc(p.trim())] || p.trim());
    return teile.length > 1 ? teile.slice(0, -1).join(', ') + ' und ' + teile[teile.length - 1] : teile[0];
  };

  function vorlageAbstimmung(zeile) {
    if (/\.\s/.test(zeile)) return null; // mehrere Sätze: nicht umbauen
    let m = zeile.match(abstRe);
    if (m) {
      const art = ab.ausgabe[lc(m[1])] || ab.ausgabe['*'];
      let was = m[3].replace(/^den\s+/iu, 'der ');
      // Begründung abtrennen: „… bezüglich X weil Y" -> „… bezüglich X durchgeführt, weil Y."
      let grund = '';
      const g = was.match(new RegExp(`^(.+?),?\\s+(${ab.begruendung.map(esc).join('|')})\\s+(.+)$`, 'iu'));
      if (g) { was = g[1]; grund = `, ${lc(g[2])} ${g[3]}`; }
      was = plusAlsSowie(was);
      return `${art} mit ${personen(m[2])} bezüglich ${was} durchgeführt${grund}.`;
    }
    // „Klärung mit FlexPos da Access B nicht online ist" -> „… durchgeführt, da …"
    m = zeile.match(abstDaRe);
    if (m) {
      const art = ab.ausgabe[lc(m[1])] || ab.ausgabe['*'];
      return `${art} mit ${personen(m[2])} durchgeführt, ${lc(m[3])} ${m[4]}.`;
    }
    return null;
  }

  function vorlageHauptwort(zeile) {
    let m = zeile.match(/^(?:Messen|Messung)(?![\p{L}])\s*(.*)$/iu);
    if (m) {
      const st = statusAbtrennen(m[1]);
      return `Messtechnische Prüfung${st.rest ? ' ' + plusAlsSowie(st.rest) : ''} ${st.status}.`;
    }
    m = zeile.match(/^Arbeiten\s+(an|in|im)\s+(.+)$/iu);
    if (m) {
      const st = statusAbtrennen(m[2]);
      return `Arbeiten ${lc(m[1])} ${st.rest} ${st.status}.`;
    }
    m = zeile.match(hauptwortRe);
    if (!m) return null;
    const wort = R.hauptwortAlias[lc(m[1])] || ersterGross(lc(m[1]));
    // „Weiterführung des Ausbaus …" bleibt ein Satz ohne „durchgeführt"
    if (ohneZusatz.has(lc(m[1]))) return m[2] ? `${wort} ${genitiv(plusAlsSowie(m[2]))}.` : null;
    const st = statusAbtrennen(m[2]);
    // „Baustellenbegehung + Vorprüfung" -> „Baustellenbegehung sowie Vorprüfung durchgeführt."
    const obj = /^\+/.test(st.rest) ? 'sowie ' + st.rest.replace(/^\+\s*/, '') : genitiv(plusAlsSowie(st.rest));
    // Partizip-Stil: „Montage der PZE" -> „PZE montiert." (nur ohne „begonnen/abgeschlossen")
    const partizip = R.partizipien[lc(m[1])];
    if (partizip && obj && /^(vollständig )?durchgeführt$/.test(st.status) && !/^(sowie|und|oder|von (der|dem|den|\d))(?![\p{L}])/iu.test(obj)) {
      const vollst = st.status.startsWith('vollständig') ? 'vollständig ' : '';
      return `${ersterGross(nominativ(obj))} ${vollst}${partizip}.`;
    }
    return `${wort}${obj ? ' ' + obj : ''} ${st.status}.`;
  }

  function vorlage(zeile) {
    const ohnePunkt = zeile.replace(/[.\s]+$/u, '');
    // Schon fertiger Satz (endet auf „durchgeführt", „montiert" …): nicht noch einmal umbauen.
    // Sonst würde ein zweiter Klick auf „Texte korrigieren" z. B. „durchgeführt" doppelt anhängen.
    if (fertigRe.test(ohnePunkt)) return null;
    // Abstimmungen dürfen einen Nebensatz mit „da …" enthalten – daher vor der Verb-Prüfung
    const abst = vorlageAbstimmung(ohnePunkt);
    if (abst) return abst;
    if (finitRe.test(ohnePunkt)) return null;
    const fest = festeZeilen.get(lc(ohnePunkt).replace(/\s+/g, ' '));
    if (fest) return fest;
    return vorlageAktion(ohnePunkt) || vorlageHauptwort(ohnePunkt);
  }

  // Zeile mit „+" zwischen zwei eigenständigen Tätigkeiten („Auto entladen + Parkplatzsuche")
  function vorlageMitPlus(zeile) {
    // Ganze Zeile als fester Satz hat Vorrang („Aufräumarbeiten und Baustellenberäumung")
    const fest = festeZeilen.get(lc(zeile.replace(/[.\s]+$/u, '')).replace(/\s+/g, ' '));
    if (fest) return fest;
    const teile = zeile.split(/\s+\+\s+|(?<=\p{L})\+(?=\p{L})/u);
    if (teile.length > 1) {
      const saetze = teile.map((t) => vorlage(t.trim()));
      if (saetze.every(Boolean)) return saetze.join(' ');
    }
    // „Werkzeug ausladen und Parkplatzsuche": nur trennen, wenn jeder Teil ein fester Satz ist
    const undTeile = zeile.replace(/[.\s]+$/u, '').split(/\s+und\s+/iu);
    if (undTeile.length > 1) {
      const saetze = undTeile.map((t) => festeZeilen.get(lc(t.trim()).replace(/\s+/g, ' ')));
      if (saetze.every(Boolean)) return saetze.join(' ');
    }
    return vorlage(zeile);
  }

  // Satz ohne Vorlage: Grundform am Ende -> Partizip, sonst nur Satzbau.
  function freierSatz(zeile) {
    let s = zeile.replace(/[.\s]+$/u, '');
    if (!finitRe.test(s)) {
      const m = s.match(/(\p{L}+)$/u);
      const p = m && R.infinitive[lc(m[1])];
      // „beim ablängen" ist ein Hauptwort, kein Infinitiv am Satzende
      const davor = s.slice(0, m ? m.index : 0).trim().split(/\s+/).pop() || '';
      if (p && s.split(/\s+/).length > 1 && !/^(beim|zum|vom|am|im|das|dem)$/iu.test(davor)) {
        s = s.slice(0, m.index) + p;
      }
      s = plusAlsSowie(s);
    }
    return s;
  }

  function satzbau(s) {
    s = s.trim();
    if (!s) return s;
    s = ersterGross(s);
    s = s.replace(/(?<!(?:bzw|ca|usw|ggf|inkl|evtl|z\.\s?B|d\.\s?h|I\.C))([.!?]\s+)(\p{Ll})/gu,
      (m, a, b) => a + b.toLocaleUpperCase('de-DE'));
    if (!/[.!?:]$/u.test(s)) s += '.';
    return s;
  }

  // ---------------- Zeilen vorbereiten ----------------
  function zeilenVorbereiten(text) {
    const roh = text.replace(/​/g, '').replace(/\r\n?/g, '\n').split('\n');
    const zeilen = [];
    roh.forEach((z, i) => {
      let s = z.trim();
      let warUeberschrift = false;
      for (const re of praefixRe) {
        if (/^\s*Punkt\s*\d/iu.test(s) && re.test(s)) warUeberschrift = true;
        s = s.replace(re, '');
      }
      s = s.trim();
      if (!s) return;
      // Überschrift des ganzen Eintrags („Bautagebuchbericht") entfällt
      if (ueberschriften.has(lc(s).replace(/[:.\s]+$/u, ''))) return;
      // „Stichwort: ganzer Satz" – das Stichwort entfällt, wenn es im Satz ohnehin vorkommt
      // („Barracuda: Barracuda ausgetauscht …", „PZE: Defektes Patchkabel am PZE …").
      // Kommt es nicht vor („Netzwerkschrank 1: Hardwareeinbau …"), bleibt es als Information.
      const st = s.match(/^([\p{L}][\p{L}-]*(?:\s[\p{L}-]+){0,3})\s*:\s+(.{20,})$/u);
      if (st && !aktionKopfRe.test(st[1]) && !hauptwortRe.test(st[1]) && !R.bereiche[lc(st[1])]) {
        const stichwort = lc(st[1].split(/[\s-]/)[0]).replace(/s$/, '');
        if (stichwort.length >= 3 && lc(st[2]).includes(stichwort)) s = st[2];
      }
      // „Punkt 2 – Stromversorgung" als reine Überschrift über weiteren Zeilen entfällt
      const folgt = roh.slice(i + 1).some((x) => x.trim());
      if (warUeberschrift && folgt && s.split(/\s+/).length <= 4 && !/[.:]$/.test(s) && !/\d/.test(s)) return;
      zeilen.push(s);
    });

    // Fortsetzungszeilen zusammenführen
    const out = [];
    let kopf = null; // „Ausbau:" mit Bereichs-Unterzeilen
    for (const s of zeilen) {
      const n = normalisiere(s);
      const nurKopf = n.match(new RegExp(`^(${aktAlt})\\s*:?$`, 'iu'));
      if (nurKopf && /:\s*$/.test(s)) { kopf = nurKopf[1]; continue; }
      if (kopf) {
        const b = s.match(/^([\p{L} -]+?)\s*:\s*\(?(.+?)\)?\s*$/u);
        if (b) { out.push(`${kopf} ${b[1]}: ${b[2]}`); continue; }
        // „Ausbau:" und darunter direkt die Liste („AP5,6,7, VoCoVo 2, …")
        if (!aktionKopfRe.test(n) && !hauptwortRe.test(n) && !finitRe.test(n)) {
          out.push(`${kopf}: ${s}`);
          kopf = null;
          continue;
        }
        kopf = null;
      }
      const vorher = out[out.length - 1];
      const nv = vorher ? normalisiere(vorher) : '';
      // Eigene Tätigkeit beginnt nie als Fortsetzung („…, PZE," gefolgt von „Arbeiten an den NWS")
      const eigeneTaetigkeit = aktionKopfRe.test(n) || hauptwortRe.test(n) || finitRe.test(n)
        || /^(Arbeiten|Messen|Messung|Alle|Sämtliche)\s/iu.test(n) || /^\(.*\)\.?$/u.test(n)
        || festeZeilen.has(lc(n).replace(/[.\s]+$/u, ''));
      // Fortsetzung: Vorzeile endet mit „:"/„," oder ist eine Liste mit „:" und diese Zeile ist
      // selbst eine Aufzählung (Komma) bzw. nur ein einzelner Eintrag („HGA").
      const offeneListe = vorher && !eigeneTaetigkeit && (/[:,]\s*$/.test(vorher)
        || (aktionKopfRe.test(nv) && /:/.test(nv) && (/,/.test(s) || s.split(/\s+/).length <= 2
          || /^[\p{L}-]+\s\d+(?:\s(?:und|bis|u\.?|\+|&)\s?\d+)?$/iu.test(s.trim()))));
      // Begründung in eigener Zeile („Ausfall" / „Da keine Arbeiten möglich sind") gehört zum
      // kurzen, unvollständigen Satz davor.
      const begruendung = vorher && /^(da|weil|denn|wegen|aufgrund|daher|deshalb)\s/iu.test(s)
        && !/[.!?:]\s*$/.test(vorher) && avlOhneTechniker(vorher).split(/\s+/).filter(Boolean).length <= 4;
      if (begruendung) {
        out[out.length - 1] = vorher.replace(/[,\s]+$/, '') + ', ' + s.charAt(0).toLocaleLowerCase('de-DE') + s.slice(1);
        continue;
      }
      if (offeneListe) {
        out[out.length - 1] = vorher.replace(/[,\s]+$/, '') + (/:\s*$/.test(vorher) ? ' ' : ', ') + s;
      } else {
        out.push(s);
      }
    }
    return out;
  }

  // ---------------- AVL ----------------
  function stunden(h) {
    const v = h.replace('.', ',');
    return v === '1' ? '1 Stunde' : `${v} Stunden`;
  }
  function avlZeile(t, h) {
    return (+t === 1 ? R.avl.formatEinTechniker : R.avl.format).replace('{t}', t).replace('{h}', stunden(h));
  }
  // Minuten -> Stunden mit Komma („90" -> „1,5")
  const minutenAlsStunden = (min) => String(Math.round((+min / 60) * 100) / 100).replace('.', ',');

  function avlHerausloesen(text) {
    const avl = [];
    for (const re of avlRe) {
      text = text.replace(re, (m, t, h) => { avl.push(avlZeile(t, h)); return ' '; });
    }
    for (const re of avlMinRe) {
      text = text.replace(re, (m, t, min) => { avl.push(avlZeile(t, minutenAlsStunden(min))); return ' '; });
    }
    if (avl.length) {
      // Reste der Angabe entfernen: „… Überlänge haben werden. AVL Zeiten" / „(, siehe E-Mail)"
      text = text.replace(/(?<![\p{L}])AVL(?:[\s-]*Zeiten)?\s*:?(?=\s*(?:[.,;)]|$))/giu, ' ')
        .replace(/\(\s*[,;]\s*/g, '(').replace(/\s*[,;]\s*\)/g, ')');
    }
    text = text.replace(/\(\s*\)/g, '').replace(/^[\s-–]+/gm, '').replace(/[ \t]{2,}/g, ' ').trim();
    return { text, avl };
  }
  // Zeile ohne AVL-Angabe (zum Zählen der Wörter: „3 Techniker a 40 Stunden Ausfall" -> „Ausfall")
  function avlOhneTechniker(s) {
    for (const re of [...avlRe, ...avlMinRe]) { re.lastIndex = 0; s = s.replace(re, ' '); re.lastIndex = 0; }
    return s.trim();
  }
  const enthaeltAvl =(s) => [...avlRe, ...avlMinRe].some((re) => { re.lastIndex = 0; const t = re.test(s); re.lastIndex = 0; return t; });

  // ---------------- Hauptfunktion ----------------
  function korrigiere(text, feld) {
    const regeln = new Set();
    const hinweise = [];
    let freieZeilen = 0;
    if (!text || !text.trim()) return { text: text || '', regeln: [], hinweise, freieZeilen };

    if (feld !== 'behinderungen' && enthaeltAvl(text)) {
      hinweise.push('AVL-Angabe gefunden – gehört in das Feld „Behinderungen".');
    }

    const saetze = [];
    let avlGesamt = 0;
    for (const zeile of zeilenVorbereiten(text)) {
      let z = zeile;
      // AVL steht direkt unter der zugehörigen Beschreibung (Spec §34, §42)
      let avl = [];
      if (feld === 'behinderungen') {
        const r = avlHerausloesen(z);
        z = r.text; avl = r.avl; avlGesamt += avl.length;
        if (avl.length) regeln.add('AVL-Angabe vereinheitlicht');
        if (!z) { saetze.push(...avl); continue; }
      }
      let bba = false;
      bbaRe.lastIndex = 0;
      if (bbaRe.test(z)) { bba = true; z = z.replace(bbaRe, ' ').trim(); }
      bbaRe.lastIndex = 0;
      if (!z) { if (bba) saetze.push(R.bbaSatz); saetze.push(...avl); continue; }

      const n = normalisiere(z);
      if (n !== satzzeichen(z)) regeln.add('Schreibweisen und Fachbegriffe');
      let satz = vorlageMitPlus(n);
      // Regex-Regeln auch auf den neu gebauten Satz anwenden („für gesamter …", „der NWS"),
      // damit ein zweiter Durchlauf nichts mehr ändert.
      if (satz) { for (const [re, ers] of regexRegeln) satz = satz.replace(re, ers); }
      if (satz) regeln.add('Standardformulierung');
      else { satz = freierSatz(n); freieZeilen++; }
      satz = satzbau(satz);
      if (bba) {
        satz += ' ' + R.bbaSatz;
        regeln.add('Verweis auf Baubehinderungsanzeige');
        if (feld !== 'behinderungen') hinweise.push('Behinderung im Feld „' + (feld === 'vorkommnisse' ? 'Vorkommnisse' : 'Tätigkeiten') + '" – gehört ggf. in das Feld „Behinderungen".');
      }
      // Doppelt eingetragene Zeile („Ankunft Baustelle" + „Ankunft auf der Baustelle.") nur einmal
      if (satz !== saetze[saetze.length - 1]) saetze.push(satz);
      saetze.push(...avl);
    }

    if (feld === 'behinderungen' && !avlGesamt && avlOhneStundenRe.test(text)) {
      hinweise.push('Techniker genannt, aber keine Stunden erkannt – AVL-Zeile bitte selbst ergänzen („AVL: X Techniker, jeweils Y Stunden.").');
    }
    for (const h of hinweisRe) if (h.re.test(text)) hinweise.push(h.text);
    if (freieZeilen) {
      hinweise.push(`${freieZeilen} ${freieZeilen === 1 ? 'Zeile wurde' : 'Zeilen wurden'} nur sprachlich bereinigt, nicht umformuliert – bitte besonders prüfen.`);
    }
    const trenner = '\n' + (R.leerzeileZeichen || '') + '\n';
    let ergebnis = saetze.join(trenner);
    // Abkürzung beim ersten Vorkommen ausschreiben (Spec §11.1): erstes „AP 12" im Feld ->
    // „Access Point (AP) 12", sofern „(AP)" nicht schon vorher ausgeschrieben steht.
    if (R.apGruppieren) {
      const bar = ergebnis.match(/(?<![\p{L}(])(des\s+)?AP (\d+)(?! und \d)/u);
      const aus = ergebnis.indexOf('(AP)');
      if (bar && (aus < 0 || bar.index < aus)) {
        const neu = bar[1] ? `${bar[1]}Access Points (AP) ${bar[2]}` : `Access Point (AP) ${bar[2]}`;
        ergebnis = ergebnis.slice(0, bar.index) + neu + ergebnis.slice(bar.index + bar[0].length);
      }
    }
    return { text: ergebnis, regeln: [...regeln], hinweise, freieZeilen };
  }

  return { korrigiere };
})();
