/* textregeln.js – Regelbasis für den Button „Texte korrigieren" im Bautagebuch.
   Reine Daten, keine Logik: neue Begriffe, Tippfehler oder Standardsätze werden hier
   ergänzt, ohne textkorrektur.js anzufassen. Abgeleitet aus den 34 Vorher/Nachher-Paaren in
   BautagebuchFormatter/Beispiele (Stil der tatsächlich abgegebenen Bautagebücher) und
   ergänzend aus BautagebuchFormatter/Specification.md.

   Schreibweise der Einträge:
   - Schlüssel in tippfehler/begriffe werden ohne Rücksicht auf Groß-/Kleinschreibung und nur
     als ganzes Wort gefunden („kabel" trifft also nicht „Patchkabel").
   - regex-Einträge sind JavaScript-Regex-Quellen (Flags immer „giu").
*/
const TEXTREGELN = {
  // Trenner zwischen zwei Absätzen. Der Excel-Export übernimmt Leerzeilen ohnehin; wer Text
  // von Hand nach Excel kopiert, kann hier '​' eintragen (unsichtbares Zeichen).
  leerzeileZeichen: '',

  // Zeilenanfänge, die entfernt werden (Spiegelstriche, „Punkt 3 –").
  // Zeilen, die nur Überschrift des ganzen Eintrags sind und entfallen
  ueberschriften: ['bautagebuchbericht', 'bautagebuch', 'tätigkeiten', 'tagesbericht'],

  praefixe: [
    '^\\s*[-–—•*·]+\\s*',
    '^\\s*Punkt\\s*\\d+\\s*[:.–-]\\s*',
    '^\\s*\\d{1,2}[.)]\\s+(?=\\p{L})',
  ],

  // ---- 1. Tippfehler (Wort -> Korrektur) ----
  tippfehler: {
    'außmetern': 'Ausmetern', 'ausmetern': 'Ausmetern',
    'eletriker': 'Elektriker', 'elekteiker': 'Elektriker', 'elektroniker': 'Elektriker',
    'zwegs': 'zwecks', 'wegs': 'zwecks',
    'entverlegung': 'Endverlegung', 'entverlegt': 'endverlegt', 'entverlegen': 'endverlegen',
    'streigtrassen': 'Steigetrassen', 'steigtrassen': 'Steigetrassen', 'steigetrassen': 'Steigetrassen',
    'sammelhamter': 'Sammelhalter',
    'blitzleuche': 'Blitzleuchte',
    'bereuen': 'beräumen',
    'comunication': 'Communication',
    'abgelenkt': 'abgelängt',
    'vortgesetzt': 'fortgesetzt',
    'arbeite': 'Arbeiten',
    'arbeitseisatz': 'Arbeitseinsatz',
    'feieraben': 'Feierabend',
    'thien': 'Thin',
    'parplatz': 'Parkplatz', 'parplatzbereich': 'Parkplatzbereich',
    'gefließt': 'gefliest', 'fließt': 'fliest', 'fließenleger': 'Fliesenleger',
    'fussboden': 'Fußboden',
    'desweiteren': 'des Weiteren',
    'akugellautsprecher': 'Kugellautsprecher',
    'bedprechungsraum': 'Besprechungsraum',
    'netzwerksschränke': 'Netzwerkschränke',
    'verkaufbereich': 'Verkaufsbereich',
    'bereit gestellt': 'bereitgestellt',
    'fertig gestellt': 'fertiggestellt',
    'fertig stellen': 'fertigstellen',
    'entgegen nehmen': 'entgegennehmen',
    'hin gehangen': 'abgelegt',
    'kamm': 'kam',
    'feierabend': 'Feierabend',
    'abschällen': 'Abschellen', 'abgeschällt': 'abgeschellt',
    'vococo': 'VoCoVo', 'vococo-ausleuchtung': 'VoCoVo-Ausleuchtung',
    'warte zeit': 'Wartezeit',
    'nidaxplatten': 'NIDAX-Platten', 'nidax platten': 'NIDAX-Platten',
    'istyleitungen': 'Y(St)Y-Leitungen', 'ystyleitungen': 'Y(St)Y-Leitungen',
    'aufchiepen': 'Aufclipsen', 'gechipt': 'geclipst',
    'datenkabelzug': 'Kabelzug',
    'trnsferkabel': 'Transferkabel', 'vogovo': 'VoCoVo', 'lautsprechekabel': 'Lautsprecherkabel',
    'einbrigen': 'Einbringen', 'serveraum': 'Serverraum', 'lilli': 'LILI', 'vorort': 'vor Ort',
    'kundenwlan': 'Kunden-WLAN', 'kunden wlan': 'Kunden-WLAN', 'displayport': 'DisplayPort',
    'lager res.': 'Lagerreserve', 'lager res': 'Lagerreserve', 'backenbereich': 'Backbereich',
    'mac adresse': 'MAC-Adresse', 'e ameise': 'E-Ameise', 'testanruf': 'Testanruf',
  },

  // ---- 2. Begriffe (Wort/Phrase -> Standardschreibweise), längere Phrasen zuerst ----
  begriffe: {
    // Netzwerkschrank: Serverschrank wird nie verwendet (Spec §64)
    'serverschränken': 'Netzwerkschränken', 'serverschränke': 'Netzwerkschränke',
    'serverschrank': 'Netzwerkschrank', 'nms': 'NWS', 'nws': 'NWS',
    // Datenleitungen
    'daten kabel': 'Datenleitungen', 'daten-kabel': 'Datenleitungen', 'datenkabeln': 'Datenleitungen',
    'datenkabel': 'Datenleitungen', 'lan kabel': 'Datenleitungen', 'netzwerkkabel': 'Datenleitungen',
    'datenleitungen': 'Datenleitungen', 'datenleitung': 'Datenleitung',
    'transfer kabel': 'Transferkabel', 'transferkabel': 'Transferkabel',
    'daten ports': 'Datenports', 'datenports': 'Datenports', 'datendosen': 'Datendosen', 'datendose': 'Datendose',
    'ysty kabel': 'Y(St)Y-Leitungen', 'ysty leitungen': 'Y(St)Y-Leitungen', 'ysty leitung': 'Y(St)Y-Leitung',
    'ysty': 'Y(St)Y',
    'cat kabel': 'CAT-Datenleitungen',
    // Systeme / Hardware
    'vocovo ausleuchtung': 'VoCoVo-Ausleuchtung',
    'vocovo headsets': 'VoCoVo-Headsets', 'vocovo headset': 'VoCoVo-Headset',
    'vocovo sendern': 'VoCoVo-Sendern', 'vocovo sender': 'VoCoVo-Sender',
    'vocovo kanal': 'VoCoVo-Kanal',
    'vocovos': 'VoCoVo-Komponenten', 'vokovos': 'VoCoVo-Komponenten',
    'vocovo': 'VoCoVo', 'vokovo': 'VoCoVo',
    "ap's": 'Access Points (AP)', 'aps': 'Access Points (AP)',
    'digital signage': 'Digital Signage', 'digitalsignage': 'Digital Signage',
    'instore communication': 'In-Store-Communication (I.C.)',
    'in-store communication': 'In-Store-Communication (I.C.)',
    'in store communication': 'In-Store-Communication (I.C.)',
    'i.c.': 'I.C.', 'i.c': 'I.C.', 'ic': 'I.C.',
    'sco kassen': 'SCO-Kassen', 'sco-kassen': 'SCO-Kassen', 'sco': 'SCO',
    'exitgate': 'Exit Gate', 'exit gate': 'Exit Gate', 'e-gate': 'Exit Gate',
    'service kasse': 'Servicekasse', 'servicekasse': 'Servicekasse',
    'reserve kasse': 'Reservekasse', 'reservekasse': 'Reservekasse',
    'lager reserve': 'Lagerreserve', 'pfand reserve': 'Pfand-Reserve',
    'kassen bereich': 'Kassenbereich', 'kassenzone': 'Kassenbereich',
    'lan switche': 'LAN-Switche', 'lan switchen': 'LAN-Switchen', 'lan switch': 'LAN-Switch',
    'headsetladeschalen': 'Headset-Ladeschalen',
    'br kanal': 'Brüstungskanal', 'br-kanal': 'Brüstungskanal',
    'thin client bo': 'Thin Client BO',
    'lbox': 'L-Box', 'l-box': 'L-Box',
    'lili': 'LILI', 'lily': 'LILI', 'lilly': 'LILI',
    // Räume klein geschrieben („im serverraum", „im büro")
    'serverraum': 'Serverraum', 'büro': 'Büro', 'kassenbüro': 'Kassenbüro', 'küche': 'Küche',
    'aktenraum': 'Aktenraum', 'besprechungsraum': 'Besprechungsraum', 'technikraum': 'Technikraum',
    'sozialraum': 'Sozialraum', 'technikebene': 'Technikebene', 'kleinverteiler': 'Kleinverteiler',
    'headsetkanal': 'Headsetkanal', 'lager': 'Lager', 'umkleide': 'Umkleide',
    'wago': 'WAGO', 'mde geräte': 'MDE-Geräte', 'owa decken': 'OWA-Decken', 'owa-decken': 'OWA-Decken',
    'xweb': 'XWEB', 'x-web': 'XWEB',
    'pze': 'PZE', 'hga': 'HGA', 'cctv': 'CCTV', 'kwlan': 'KWLAN', 'kvm': 'KVM', 'mats': 'MAT', 'mat': 'MAT',
    'baracuda': 'Barracuda', 'barracuda': 'Barracuda',
    'fortigate': 'FortiGate', 'forti gate': 'FortiGate',
    'flex pos': 'FlexPos', 'flexpos': 'FlexPos',
    'lidl': 'Lidl',
    'email': 'E-Mail', 'e-mail': 'E-Mail',
    // Bereiche
    'verkaufsraum': 'Verkaufsbereich', 'verkauf': 'Verkaufsbereich',
    'perso': 'Personalraum',
    'bilddoku': 'Fotodokumentation', 'fotodoku': 'Fotodokumentation',
    // Hauptwörter, die oft klein getippt werden
    'leiter': 'Leiter', 'kabelweg': 'Kabelweg', 'kabelwegs': 'Kabelwegs', 'kabelweges': 'Kabelweges',
    'kabelwege': 'Kabelwege', 'leerpanels': 'Leerpanels', 'erdungsfahnen': 'Erdungsfahnen',
  },

  // ---- 3. Regex-Ersetzungen nach den Begriffen (Reihenfolge ist wichtig) ----
  regex: [
    // Netzwerkschränke mit Artikel ausschreiben (Stil der Beispiele)
    ['(an|in) den NWS(?![\\p{L}\\d(])', '$1 den Netzwerkschränken (NWS)'],
    ['(in|für) die NWS(?![\\p{L}\\d(])', '$1 die Netzwerkschränke (NWS)'],
    ['\\bder NWS(?![\\p{L}\\d(])', 'der Netzwerkschränke (NWS)'],
    ['\\bdie NWS(?![\\p{L}\\d(])', 'die Netzwerkschränke (NWS)'],
    ['Netzwerkschränke(n?)(?!\\s*\\(NWS\\))(?=[\\s.,;]|$)', 'Netzwerkschränke$1 (NWS)'],
    // DS ohne Ausschreibung -> Digital Signage (DS)
    ['(?<![\\p{L}(])DS(?![\\p{L})])', 'Digital Signage (DS)'],
    // Abkürzungen ausschreiben – nicht, wenn sie schon in Klammern hinter dem Begriff stehen
    // (sonst entstünde beim zweiten Korrigieren „Access Points (AP) (AP)")
    ['(?<![\\p{L}])Access Points(?!\\s*\\(AP\\))', 'Access Points (AP)'],
    ['(?<![\\p{L}(])KV(?![\\p{L})])', 'Kleinverteiler (KV)'],
    // „vocovo 3und ,besprechung" -> „VoCoVo 3, Besprechungsraum": angeklebtes „und" lösen,
    // „und" direkt vor einem Komma entfällt
    ['(\\d)(und|u\\.)(?=[\\s,]|$)', '$1 und'],
    ['\\s+und\\s*,\\s*', ', '],
    // „I.C.im" -> „I.C. im" (sonst entstünde „I.C..im")
    ['I\\.C\\.\\.?(?=\\p{L})', 'I.C. '],
    // „in denn Serverraum" -> „in den Serverraum"
    ['(?<![\\p{L}])(in|für|auf|an|über) denn (?=\\p{Lu})', '$1 den '],
    // „IC1", „IC 2" -> „I.C. 1"
    ['(?<![\\p{L}.])IC\\s*(?=\\d)', 'I.C. '],
    // „NWS in den Serverraum …" am Zeilenanfang ausschreiben (nicht „NWS 1")
    ['^NWS(?=\\s+(?!\\d))', 'Netzwerkschränke (NWS)'],
    // „in den Serverraum gebracht" -> „in den Serverraum eingebracht"
    ['((?<![\\p{L}])in (?:den|die|das) [\\p{L}-]+) gebracht(?![\\p{L}])', '$1 eingebracht'],
    // „I.C. Brücken" -> „I.C.-Brücken" (zusammengesetztes Wort)
    ['I\\.C\\.\\s+(?=Brücke)', 'I.C.-'],
    // „(die mit der Leiter möglich waren)" -> „(soweit mit der Leiter erreichbar)"
    ['\\(\\s*die\\s+mit\\s+der\\s+Leiter\\s+(?:möglich|erreichbar)\\s+waren\\s*\\)', '(soweit mit der Leiter erreichbar)'],
    // „Besprechung 1+2" ist der Raum, „Besprechung mit …" nicht
    ['(?<![\\p{L}])Besprechung(?=\\s*\\d|\\s*[,.)]|\\s*$)', 'Besprechungsraum'],
    // AP mit Nummer: „AP10", „Ap 10" -> „AP 10"
    ['(?<![\\p{L}])AP\\s*(?=\\d)', 'AP '],
    // „für gesamter Kassenbereich" -> „für den gesamten Kassenbereich"
    ['(?<![\\p{L}])für gesamte[rnm]?\\s', 'für den gesamten '],
    ['\\s+UND\\s+', ' und '],
    // „Access Points (APs)" wurde zu „Access Points (AP) (Access Points (AP))"
    ['Access Points \\(AP\\)\\s*\\(Access Points \\(AP\\)\\)', 'Access Points (AP)'],
  ],

  // Zeilen, die mit einer Grundform enden („Material im Serverraum zwischenlagern"),
  // bekommen das Partizip („… zwischengelagert.").
  infinitive: {
    'bringen': 'gebracht', 'beräumen': 'beräumt', 'zwischenlagern': 'zwischengelagert',
    'fertigstellen': 'fertiggestellt', 'laden': 'geladen', 'einladen': 'eingeladen',
    'ausladen': 'ausgeladen', 'entladen': 'entladen', 'holen': 'geholt', 'entgegennehmen': 'entgegengenommen',
    'aufbauen': 'aufgebaut', 'abbauen': 'abgebaut', 'montieren': 'montiert', 'einbauen': 'eingebaut',
    'ausbauen': 'ausgebaut', 'auflegen': 'aufgelegt', 'patchen': 'gepatcht', 'messen': 'gemessen',
    'verlegen': 'verlegt', 'endverlegen': 'endverlegt', 'umverlegen': 'umverlegt', 'ablängen': 'abgelängt',
    'beschriften': 'beschriftet', 'reinigen': 'gereinigt', 'säubern': 'gesäubert', 'stellen': 'gestellt',
    'aufstellen': 'aufgestellt', 'einführen': 'eingeführt', 'sortieren': 'sortiert', 'prüfen': 'geprüft',
    'ausrichten': 'ausgerichtet', 'einbringen': 'eingebracht',
  },

  // Kurze Zusätze hinter „+", die keine eigene Tätigkeit nennen („Ablängen Transferkabel +
  // einseitig Module") -> „Ablängen der Transferkabel durchgeführt sowie einseitig Module montiert."
  zusatzTaetigkeiten: {
    'einseitig module': 'einseitig Module montiert', 'module einseitig': 'einseitig Module montiert',
    'beidseitig module': 'beidseitig Module montiert', 'module beidseitig': 'beidseitig Module montiert',
    'module': 'Module montiert',
  },

  // Wörter, an die eine Nummer ohne Leerzeichen angehängt sein kann („Kassen1-5").
  nummernPraefixe: ['Kassen', 'Kasse', 'SCO', 'CCTV', 'Lager', 'Pfand', 'Backen', 'Druckerlager',
    'Drucker', 'Personal', 'Besprechungsraum', 'HGA', 'BakeOff', 'VoCoVo', 'Digital Signage',
    'I.C.', 'Netzwerkschrank'],

  // ---- 4. Ganze Zeilen mit festem Standardsatz (nach Normalisierung, ohne Punkt) ----
  festeZeilen: [
    { zeilen: ['material ausladen', 'materialien ausladen', 'material ausgeladen',
        'ausladen der arbeitsmaterialien', 'ausladen von arbeitsmaterial', 'arbeitsmaterial ausladen',
        'ausladen der arbeitsmittel', 'arbeitsmittel ausladen'],
      satz: 'Arbeitsmaterialien ausgeladen.' },
    { zeilen: ['auto entladen', 'werkzeug ausladen', 'auto ausladen', 'material und werkzeug ausladen',
        'werkzeug und material ausladen'],
      satz: 'Arbeitsmaterialien und Werkzeuge ausgeladen.' },
    { zeilen: ['auto umparken', 'fahrzeug umparken', 'umparken'], satz: 'Fahrzeug umgeparkt.' },
    { zeilen: ['auto beladen', 'auto laden', 'material einladen', 'material eingeladen', 'werkzeug einladen',
        'material ins auto laden', 'material von der baustelle ins auto laden',
        'material der baustelle ins auto geladen', 'auto beladen mit material und werkzeug',
        'material ins auto', 'material auto'],
      satz: 'Arbeitsmaterialien und Werkzeuge in das Fahrzeug verladen.' },
    { zeilen: ['baustelle beräumen', 'baustelle beräumt', 'baustellenberäumung', 'beräumung der baustelle',
        'baustelle aufgeräumt', 'aufräumen der baustelle', 'säubern der baustelle'],
      satz: 'Die Baustelle wurde beräumt.' },
    { zeilen: ['baustellenbegehung', 'begehung baustelle', 'baustellen begehung', 'begehung der baustelle',
        'begehung'],
      satz: 'Baustellenbegehung durchgeführt.' },
    { zeilen: ['ankunft baustelle', 'ankunft auf der baustelle', 'angekommen'],
      satz: 'Ankunft auf der Baustelle.' },
    { zeilen: ['organisatorisches'], satz: 'Organisatorische Abstimmungen durchgeführt.' },
    { zeilen: ['parkplatzsuche'], satz: 'Parkplatzsuche durchgeführt.' },
    { zeilen: ['vocovo-ausleuchtung'], satz: 'VoCoVo-Ausleuchtung durchgeführt.' },
    { zeilen: ['restlicher kabelzug'], satz: 'Restlicher Kabelzug der Datenleitungen durchgeführt.' },
    { zeilen: ['fotos', 'bilder', 'fotodokumentation', 'fotos gemacht', 'bilder gemacht',
        'erstellung fotodokumentation', 'erstellung der fotodokumentation'],
      satz: 'Fotodokumentation erstellt.' },
    { zeilen: ['aufräumarbeiten und baustellenberäumung', 'aufräumarbeiten'],
      satz: 'Aufräumarbeiten durchgeführt und die Baustelle beräumt.' },
  ],

  // ---- 5. Tätigkeiten mit Leitungsbezug: „Ausmetern, Ablängen und Beschriften der Kabel für …" ----
  // eingabe = Wortformen des Technikers, nomen = Ausgabe, objekt = Standardobjekt.
  aktionen: [
    { eingabe: ['kabelzug', 'kabelziehen'], nomen: 'Kabelzug', objekt: 'der Datenleitungen' },
    { eingabe: ['verlegen', 'verlegung'], nomen: 'Verlegung', objekt: 'der Datenleitungen' },
    { eingabe: ['ablängen', 'abgelängt'], nomen: 'Ablängen', objekt: 'der Datenleitungen' },
    { eingabe: ['ausmetern', 'ausmessen', 'ausgemessen'], nomen: 'Ausmessen', objekt: 'der Datenleitungen' },
    { eingabe: ['beschriften', 'beschriftet'], nomen: 'Beschriften', objekt: 'der Datenleitungen' },
    { eingabe: ['endverlegung', 'endverlegen', 'endverlegt'], nomen: 'Endverlegung', objekt: 'der Datenleitungen' },
    { eingabe: ['kabelumverlegung', 'umverlegung', 'umverlegen'], nomen: 'Umverlegung', objekt: 'der Datenleitungen' },
    { eingabe: ['ausbau'], nomen: 'Ausbau', objekt: 'der Datendosen' },
  ],
  // Objektwörter, die der Techniker hinter die Tätigkeit schreibt. Wert null = Standardobjekt
  // der Tätigkeit verwenden, sonst dieses Objekt.
  aktionsObjekte: {
    'der Datenleitungen': null, 'der Datenleitung': null, 'von Datenleitungen': null, 'Datenleitungen': null,
    'der Kabel': null, 'von Kabeln': null, 'Kabel': null,
    'der Datendosen': 'der Datendosen', 'von Datendosen': 'der Datendosen', 'Datendosen': 'der Datendosen',
    'der Datenports': null, 'Datenports': null,
    'der Transferkabel': 'der Transferkabel', 'Transferkabel': 'der Transferkabel',
    'aller Datenleitungen': 'sämtlicher Datenleitungen', 'sämtlicher Datenleitungen': 'sämtlicher Datenleitungen',
    'aller Kabel': 'sämtlicher Datenleitungen',
    'aller Transferkabel': 'sämtlicher Transferkabel', 'sämtlicher Transferkabel': 'sämtlicher Transferkabel',
    'der restlichen Datendosen': 'der restlichen Datendosen', 'aller Datendosen': 'sämtlicher Datendosen',
  },
  // Einzelne Listeneinträge, die eine feste Schreibweise bekommen
  listenEintraege: {
    'pfand': 'Pfandbereich', 'backen': 'Backbereich', 'sozialraum küche': 'Sozialraum/Küche',
    'kassen': 'Kassenbereich', 'verkaufsbereich': 'Verkaufsbereich', 'lager': 'Lager',
    'aktenraum': 'Aktenraum', 'kleinverteiler': 'Kleinverteiler', 'küche': 'Küche', 'büro': 'Büro',
    'technikebene': 'Technikebene', 'serverraum': 'Serverraum', 'headsetkanal': 'Headsetkanal', 'besprechungsraum': 'Besprechungsraum', 'bedienerkassen': 'Bedienerkassen', 'komplett backen': 'kompletter Backbereich',
  },
  // Bereichsangabe vor der Liste („Ausbau Verkauf: AP 2, …") -> Dativ
  bereiche: {
    'verkaufsbereich': 'im Verkaufsbereich', 'lager': 'im Lagerbereich', 'lagerbereich': 'im Lagerbereich',
    'sozialbereich': 'im Sozialbereich', 'büro': 'im Büro', 'pfand': 'im Pfandbereich',
    'pfandbereich': 'im Pfandbereich', 'kassenbereich': 'im Kassenbereich', 'küche': 'in der Küche',
  },

  // ---- 6. Tätigkeiten als Hauptwort („Montage Blitzleuchte") -> „… durchgeführt." ----
  hauptwoerter: ['Montage', 'Demontage', 'Annahme', 'Aufnahme', 'Einbau', 'Aufbau', 'Neuaufbau', 'Zusammenbau',
    'Inbetriebnahme', 'Patchung', 'Registrierung', 'Fertigstellung', 'Weiterführung', 'Fortführung',
    'Sortieren', 'Einführen', 'Auflegen', 'Aufteilen', 'Abschellen', 'Stellen', 'Vorbereitung',
    'Kontrolle', 'Reinigung', 'Zurücksetzen', 'Versuch', 'Austausch', 'Tausch', 'Prüfung', 'Beschriftung',
    'Baustellenbegehung', 'Beginn', 'Konfiguration', 'Verbinden', 'Bereinigung', 'Patchen', 'Fehlersuche',
    'Querungen', 'Hereinbringen', 'Reinbringen', 'Einbringen'],
  // Abweichende Ausgabe für ein Hauptwort („Patchen der NWS" -> „Patchung der …")
  hauptwortAlias: { 'patchen': 'Patchung' },
  // Kurzer Partizip-Stil (Stil der neueren Bautagebücher, mit Michael abgestimmt):
  // „Montage der PZE" -> „PZE montiert.", „Einbau der Hardware in die NWS" -> „Hardware in die
  // Netzwerkschränke (NWS) eingebaut." Hauptwörter ohne Eintrag hier behalten „… durchgeführt.".
  partizipien: {
    'montage': 'montiert', 'demontage': 'demontiert', 'aufnahme': 'aufgenommen', 'einbau': 'eingebaut',
    'aufbau': 'aufgebaut', 'neuaufbau': 'neu aufgebaut', 'zusammenbau': 'zusammengebaut',
    'inbetriebnahme': 'in Betrieb genommen', 'registrierung': 'registriert', 'konfiguration': 'konfiguriert',
    'verbinden': 'verbunden', 'bereinigung': 'bereinigt', 'beschriftung': 'beschriftet',
    'annahme': 'entgegengenommen', 'sortieren': 'sortiert', 'einführen': 'eingeführt', 'auflegen': 'aufgelegt',
    'aufteilen': 'aufgeteilt', 'abschellen': 'abgeschellt', 'stellen': 'aufgestellt', 'reinigung': 'gereinigt',
    'austausch': 'ausgetauscht', 'tausch': 'getauscht', 'kontrolle': 'kontrolliert', 'vorbereitung': 'vorbereitet',
    'hereinbringen': 'hereingebracht', 'reinbringen': 'hereingebracht', 'einbringen': 'eingebracht',
  },
  // Mehrere „AP n" in einer Liste -> „Access Points (AP) 1, 2 und 4"; erste Einzelnennung im
  // Feld -> „Access Point (AP) 12".
  apGruppieren: true,
  // Diese Hauptwörter bilden schon einen Satz – kein „durchgeführt" anhängen.
  hauptwoerterOhneZusatz: ['Weiterführung', 'Fortführung', 'Fertigstellung', 'Beginn'],
  // Statuswörter am Zeilenende -> Ausgabe statt „durchgeführt"
  status: {
    'begonnen': 'begonnen', 'angefangen': 'begonnen', 'beendet': 'abgeschlossen',
    'abgeschlossen': 'abgeschlossen', 'fertiggestellt': 'abgeschlossen', 'fertig': 'abgeschlossen',
    'fortgesetzt': 'fortgesetzt', 'weitergeführt': 'fortgesetzt', 'veranlasst': 'veranlasst',
  },
  // Objekt ohne Artikel -> Genitiv mit Artikel (Anfang des Objekts wird verglichen)
  genitiv: {
    'blitzleuchte': 'der Blitzleuchte', 'pze': 'der PZE', 'headsetkanal': 'des Headsetkanals',
    'backschema': 'des Backschemas', 'lili': 'der LILI', 'kleinverteiler (kv)': 'des Kleinverteilers (KV)',
    'kleinverteiler': 'des Kleinverteilers', 'headset-ladeschalen': 'der Headset-Ladeschalen',
    'kugellautsprecher': 'der Kugellautsprecher', 'kassenleuchten': 'der Kassenleuchten', 'mat': 'des MAT',
    'außenantennen': 'der Außenantennen', 'brüstungskanal': 'des Brüstungskanals',
    'netzwerkschränke (nws)': 'der Netzwerkschränke (NWS)', 'nws': 'der Netzwerkschränke (NWS)',
    'kwlan': 'des KWLAN', 'panels': 'der Panels', 'panel': 'der Panels', 'hardware': 'der Hardware',
    'access points (ap)': 'der Access Points (AP)', 'transferkabel': 'der Transferkabel',
    'telefone': 'der Telefone', 'headsets': 'der Headsets', 'vocovo-headsets': 'der VoCoVo-Headsets', 'büro': 'des Büros', 'lautsprecher': 'der Lautsprecher',
    'mde-geräte': 'der MDE-Geräte', 'kassenbüro': 'des Kassenbüros', 'sdp': 'der SDP',
    'ap': 'des AP', 'access points (ap)': 'der Access Points (AP)',
  },

  // ---- 7. Abstimmungen: „Klärung mit Elektriker wegen …" ----
  abstimmung: {
    eingabe: ['klärung', 'klärungen', 'abklärung', 'abstimmung', 'rücksprache', 'absprache', 'besprechung',
      'telefonieren', 'telefonat'],
    // Stil der neueren Beispiele (Bernburg, Eichstätt): „Organisatorische Abstimmung mit …"
    ausgabe: { 'rücksprache': 'Rücksprache', 'telefonieren': 'Telefonische Abstimmung',
      'telefonat': 'Telefonische Abstimmung', '*': 'Organisatorische Abstimmung' },
    praeposition: ['wegen', 'zwecks', 'bezüglich', 'bzgl.', 'bzgl', 'über', 'hinsichtlich'],
    // „Klärung mit FlexPos da …" -> „Organisatorische Abstimmung mit FlexPos durchgeführt, da …"
    begruendung: ['da', 'weil'],
    personen: {
      'elektriker': 'dem Elektriker', 'dem elektriker': 'dem Elektriker', 'support': 'dem Support',
      'dem support': 'dem Support', 'bauleiter': 'der Bauleitung', 'bauleitung': 'der Bauleitung',
      'der bauleitung': 'der Bauleitung', 'gu': 'dem Generalunternehmer (GU)', 'flexpos': 'FlexPos',
      'polier': 'dem Polier', 'plb': 'dem PLB', 'lidl': 'Lidl',
    },
  },

  // ---- 8. AVL (nur Feld Behinderungen) ----
  avl: {
    // Gruppe 1 = Techniker, Gruppe 2 = Stunden/Minuten, Gruppe 3 = optionaler Zeitraum
    // („für die gesamte Woche", „für KW 46"), der in der AVL-Zeile erhalten bleibt.
    // Komma nach „Techniker" erlaubt: „2 Techniker, je 120 Stunden".
    muster: [
      // „3 Techniker 8h", „3 Mann a 2,5 Stunden", „2 Man a 2 Stunden", „1 Techniker 1 Stunde"
      '(\\d+)\\s*(?:Techniker|Mann|Man|MA|Mitarbeiter|Personen|Person)\\s*,?\\s*(?:à|á|a|je|jeweils|x|mit|für)?\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:h|Std\\.?|Stunden|Stunde)(?![\\p{L}])(?:\\s+((?:für|in|während)\\s+(?:die\\s+|der\\s+|den\\s+)?(?:gesamte[nr]?\\s+|ganze[nr]?\\s+|komplette[nr]?\\s+)?(?:Woche|KW\\s*\\d+|Tag)))?',
      // „1x1,5h", „1x0,25h"
      '(\\d+)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*(?:h|Std\\.?|Stunden|Stunde)(?![\\p{L}])(?:\\s+((?:für|in|während)\\s+(?:die\\s+|der\\s+|den\\s+)?(?:gesamte[nr]?\\s+|ganze[nr]?\\s+|komplette[nr]?\\s+)?(?:Woche|KW\\s*\\d+|Tag)))?',
    ],
    // „1 Techniker 90 Minuten" -> Minuten werden in Stunden umgerechnet
    musterMinuten: [
      '(\\d+)\\s*(?:Techniker|Mann|Man|MA|Mitarbeiter|Personen|Person)\\s*,?\\s*(?:à|á|a|je|jeweils|x|mit|für)?\\s*(\\d+)\\s*(?:min|Min\\.?|Minuten)(?![\\p{L}])(?:\\s+((?:für|in|während)\\s+(?:die\\s+|der\\s+|den\\s+)?(?:gesamte[nr]?\\s+|ganze[nr]?\\s+|komplette[nr]?\\s+)?(?:Woche|KW\\s*\\d+|Tag)))?',
      '(\\d+)\\s*[x×]\\s*(\\d+)\\s*(?:min|Min\\.?|Minuten)(?![\\p{L}])(?:\\s+((?:für|in|während)\\s+(?:die\\s+|der\\s+|den\\s+)?(?:gesamte[nr]?\\s+|ganze[nr]?\\s+|komplette[nr]?\\s+)?(?:Woche|KW\\s*\\d+|Tag)))?',
    ],
    // Techniker genannt, aber keine Stunden -> Hinweis
    ohneStunden: '(\\d+)\\s*(?:Techniker|Mann|Man|Mitarbeiter|Personen|Person)(?![\\p{L}])',
    format: 'AVL: {t} Techniker, jeweils {h}{z}.',
    formatEinTechniker: 'AVL: 1 Techniker, {h}{z}.',
  },
  bbaSatz: 'Die Gründe sind der Baubehinderungsanzeige zu entnehmen.',
  bbaVerweis: '\\(?\\s*(?:siehe|sie|s\\.)\\s+(?:Baubehinderungsanzeige|BBA|Behinderungsanzeige)\\s*\\)?',

  // ---- 9. Hinweise (werden NICHT automatisch geändert, nur angezeigt) ----
  hinweise: [
    { muster: '(?<![\\p{L}])(ich|wir|uns|unser|unsere|unseren|unserer)(?![\\p{L}])',
      text: 'Ich-/Wir-Form gefunden – sachlich ohne Personen formulieren.' },
    { muster: '(?<![\\p{L}])(angeblich|wohl|vermutlich)(?![\\p{L}])',
      text: 'Vermutung gefunden („angeblich/wohl") – nur gesicherte Fakten dokumentieren.' },
    { muster: '(FlexPos|Bauleitung|Bauleiter|GU|Elektriker)\\s+(hat|haben)\\s+(nicht|vergessen)|Pfusch|Schuld|vergessen',
      text: 'Mögliche Schuldzuweisung – neutral formulieren (z. B. „Aufgrund fehlender Vorleistungen …").' },
    { muster: 'siehe\\s+(Mail|E-Mail|PDF|Anzeige)',
      text: '„siehe Mail/PDF" vermeiden – Pflichtsatz: „Die Gründe sind der Baubehinderungsanzeige zu entnehmen."' },
  ],
};
