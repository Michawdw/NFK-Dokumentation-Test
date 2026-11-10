/* korrekturspeicher.js – Merkzettel für den Button „Texte korrigieren“.
   Satzpaare „Originalzeile -> richtige Zeile“, die vor den Regeln aus textregeln.js gelten.
   Diese Datei wird vom AVL-Tool (Reiter „Bautagebuch-Texte“, Button „Merkzettel für die App
   speichern“) erzeugt und von Hand in den Ordner js/ kopiert – nicht von Hand bearbeiten.
   Danach tools/make_deploy.py starten: erhöht die Version, wenn sich der Merkzettel geändert hat.
   Erzeugt am 09.11.2026 16:01, 50 Einträge.
*/
var KORREKTURSPEICHER = {
  "stand": "2026-11-09",
  "taetigkeiten": {
    "ablängen der datenkabel:service kasse,sco kassen 1-6,exit gate, kasse 1-3,reserve kasse,cctv 1+2, aktenraum,kleinverteiler,ap4,headsetkanal, pze,ic1,ic2": "Ablängen der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, Aktenraum, Kleinverteiler (KV), Access Point (AP) 4, Headsetkanal, PZE, I.C. 1 sowie I.C. 2 durchgeführt.",
    "ablängen der transferkabel für und einseitiges auflegen durchgeführt": "Ablängen der Transferkabel für und einseitiges Auflegen durchgeführt.",
    "abschelen der steigetrasse über dem serverraum": "Abschelen der Steigetrasse über dem Serverraum.",
    "aktenraum,kleinverteiler,ap4,pze, headsetkanal": "Kabelzug der Datenleitungen für Aktenraum, Kleinverteiler (KV), Access Point (AP) 4, PZE sowie Headsetkanal durchgeführt.",
    "arbeiten an den netzwerkschränken (nws) abgeschlossen. patchpanels fertiggestellt, leerpanels eingebaut sowie die erdungsfahnen der patchpanels angeschlossen": "Arbeiten an den Netzwerkschränken (NWS) abgeschlossen. Patchpanels fertiggestellt, Leerpanels eingebaut sowie die Erdungsfahnen der Patchpanels angeschlossen.",
    "arbeiten an den netzwerkschränken(datenleitungen panelweise in die schränke eingeführt, keystonemodule aufgelegt) durchgeführt": "Arbeiten an den Netzwerkschränken(Datenleitungen Panelweise in die Schränke eingeführt, Keystone-Module aufgelegt)",
    "arbeiten an den nws, begonnen transferpanel zu montieren": "Arbeiten an den Netzwerkschränken (NWS), begonnen Transferpanel zu montieren.",
    "arbeiten an den wie sortierung der verkabelung und auflegend der cat-module fortgeführt": "Arbeiten an den NWS sowie Sortierung der Verkabelung und auflegend der Cat-Module fortgeführt",
    "auflegen des checks für den headsetkanal": "Keystone-Modul für den Headsetkanal aufgelegt.",
    "ausbau der datendosen für xweb, ema / ema 2, access a / access b, ets, l-box, wago sowie ausbau i.c. 2 strecken durchgeführt": "Ausbau der Datendosen für XWEB, EMA / EMA 2, Access A / Access B, ETS, L-Box, WAGO sowie Ausbau der I.C. 2 Strecken durchgeführt.",
    "ausbau: büro, vocovo1, kabelbinder entfernen + steigtrassen abschellen": "Ausbau der Datendosen für Büro sowie VoCoVo 1 durchgeführt.\nKabelbinder entfernt.\nSteigtrassen abgeschellt.",
    "beginn des ausbaus der kabelwege für die instore communication (i.c.) im verkaufsbereich": "Beginn des Ausbaus der Kabelwege für die Instore Communication (I.C.) im Verkaufsbereich.",
    "brücken für die instore communication (i.c.) eingezogen": "Brücken für die In-Store-Communication (I.C.) eingezogen.",
    "checks auf die rangierkabel montiert. kabel in die nws eingeführt": "Keystone-Module auf die Rangierkabel montiert.\nKabel in die Netzwerkschränke (NWS) eingeführt.",
    "einbau und montage der vorhandenen hardware in den netzwerkschränken (nws) fortgeführt": "Einbau und Montage der vorhandenen Hardware in den Netzwerkschränken (NWS) fortgeführt.",
    "fertigstellung der brücken für i.c": "Kabelbrücken für die In-Store-Communication (I.C.) fertiggestellt.",
    "fertigstellung des ausbaus der kabelwege für die instore communication (i.c.)": "Fertigstellung des Ausbaus der Kabelwege für die In-Store-Communication (I.C.).",
    "fotodoku weitergeführt fertigstellung der patchung in den nws 1 bis 3 alle geräte online": "Fotodokumentation fortgeführt.\nFertigstellung der Patchung in den Netzwerkschränken (NWS) 1 bis 3 durchgeführt.\nAlle Geräte waren online.",
    "headsetkanal,pze,ic1,ic2": "Headsetkanal, PZE, I.C. 1 sowie I.C. 2 montiert.",
    "inbetriebnahme der telefone sowie testanruf mit herrn weise von wdw": "Telefone in Betrieb genommen.\nTestanruf mit Herrn Weise von WdW durchgeführt.",
    "inbetriebnahme des kassenbüros und konfiguration der aps": "Kassenbüro in Betrieb genommen.\nKonfiguration der Access Points (AP) durchgeführt.",
    "kabelzug der datenkabel:service kasse,sco kasse 1-6,exit gate,kasse 1-3,reserve kasse,cctv 1+2,ic1,ic2": "Kabelzug der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, I.C. 1 sowie I.C. 2 durchgeführt.",
    "kabelzug durchgeführt und die datenleitungen für die sco-kassen, die servicekasse, das exit gate, den backbereich, den pfandbereich sowie den aktenraum verlegt": "Kabelzug der Datenleitungen für die SCO-Kassen, die Servicekasse, das Exit Gate, den Backbereich, den Pfandbereich sowie den Aktenraum durchgeführt.",
    "kabelzug im verkaufsbereich vollständig durchgeführt und die datenleitungen endverlegt": "Kabelzug der Datenleitungen im Verkaufsbereich vollständig durchgeführt und die Datenleitungen endverlegt.",
    "klärung wegen lüftungsrohr im serverraum(tür lässt sich nich öffnen)": "Organisatorische Abstimmung bezüglich des Lüftungsrohres im Serverraum durchgeführt, da sich die Tür nicht öffnen ließ.",
    "kontrolle der vorgesehenen kabelwege, kabeltrassen, bereits montierten trassen, brüstungskanäle sowie der vorhandenen wand- und deckendurchbrüche": "Kontrolle der vorgesehenen Kabelwege, Kabeltrassen, bereits montierten Kabeltrassen, Brüstungskanäle sowie der vorhandenen Wand- und Deckendurchbrüche durchgeführt.",
    "lautsprecher im verkauf gehangen": "Lautsprecher im Verkaufsbereich installiert.",
    "material auf die baustelle geräumt außmetern der datenkabel für service kasse,sco kasse 1-6,exit gate,kasse 1-3 + reserve kasse,cctv 1+2,aktenraum,kleinverteiler,ap4": "Arbeitsmaterialien ausgeladen.\nAusmessen der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, Aktenraum, Kleinverteiler (KV) sowie Access Point (AP) 4 durchgeführt.",
    "messen der noch fehlenden datenleitungen, ausgenommen kassen sowie digital signage 2 und 3": "Messtechnische Prüfung der noch fehlenden Datenleitungen, ausgenommen Kassen sowie Digital Signage 2 und 3.",
    "restlich lautsprecher gehangen": "Restliche Lautsprecher montiert.",
    "schränke türen eingehangen": "Türen der Netzwerkschränke (NWS) eingehangen.",
    "stellen und ausrichten der nws": "Netzwerkschränke (NWS) aufgestellt und ausgerichtet.",
    "säuberung der baustelle durchgeführt": "Die Baustelle wurde beräumt.",
    "transferkabel beschriftet und abgelängt": "Beschriften und Ablängen der Transferkabel durchgeführt.",
    "trassierung richtung technik und bür wird zurück gebaut und bis 24 .07.2026 wieder montiert da lüftungskanäle geräte": "Trassierung Richtung Technik und Büro wird zurück gebaut und bis 24 .07.2026 wieder montiert da Lüftungskanäle Geräte montiert werden müssen"
  },
  "behinderungen": {
    "2 techniker 1 stunde um nws in die filiale zu einzubringen": "Einbringen der Netzwerkschränke (NWS) in die Filiale.\nAVL: 2 Techniker, jeweils 1 Stunde.",
    "26 h avl wartezeit auf sdp lieferung bis 20.20 uhr, lieferung ist nicht gekommen": "Wartezeit auf die Lieferung des SDP bis 20:20 Uhr. Die Lieferung ist nicht erfolgt.\nAVL: 26 Techniker, jeweils 1 Stunde.",
    "ab mittag konnte ich erst mit serverschränk 1 beginnen da die steigetrasse erst vorhanden war": "Ab Mittag konnten die Arbeiten an den Netzwerkschränken (NWS) begonnen werden, da die Steigetrasse erst ab diesem Zeitpunkt vorhanden war.",
    "durch den aktuellen baufortschritt, immer noch fehlende endausbauten der kabelwege sind beschleunigungsmaßnahmen notwendig": "Aufgrund des aktuellen Baufortschritts sowie der weiterhin fehlenden Endausbauten der Kabelwege sind Beschleunigungsmaßnahmen erforderlich.",
    "erschwerten kabelzug an den kassen da trassen zu na unter den holzbindern sitzt i": "Erschwerter Kabelzug im Kassenbereich, da die Trassen zu nah unter den Holzbinder montiert waren.",
    "erschwertes ablängen der datenkabel da keine geeignete strecke vorhanden ist wo uns keiner über die kabel fährt, deswegen wurde nachtschicht beantragt. siehe baubehinderungsanzeige": "Erschwertes Ablängen der Datenleitungen, da keine geeignete Strecke vorhanden war, auf der die Datenleitungen ausgelegt werden konnten, ohne dass diese überfahren wurden. Aus diesem Grund wurde Nachtschicht beantragt. Die Gründe sind der Baubehinderungsanzeige zu entnehmen.",
    "erschwertes arbeiten aufgrund von fehlenden licht in den serverräumen. avl 1 techniler 4 stunden": "Erschwertes Arbeiten aufgrund fehlender Beleuchtung in den Serverräumen.\nAVL: 1 Techniker, 4 Stunden.",
    "für die laufende woche werden wir daher ausfallzeiten für drei techniker mit jeweils 40 arbeitsstunden ( insgesamt 120h) als mehraufwendungen geltend machen": "Für die laufende Woche entstehen Ausfallzeiten von drei Technikern.\nAVL: 3 Techniker, jeweils 40 Stunden."
  },
  "vorkommnisse": {
    "außenantennen wäre eh nicht möglich gewesen kein durchbruch nach außen und der serverraum liegt inne in der filiale bis zur außenwand ca 15 bis 20m kabelweg montiert": "Die Montage der Außenantennen konnte nicht durchgeführt werden, da kein Wanddurchbruch nach außen vorhanden war. Der Serverraum befand sich im Inneren der Filiale und bis zur Außenwand waren bereits Kabelwege mit einer Länge von ca. 15 bis 20 m montiert.",
    "das kwlan konnte noch nicht inbetriebnahme genommen werden da der support laut eigener aussage auch noch keine ahnung von der neuen frederix hat": "Das KWLAN konnte noch nicht in Betrieb genommen werden, da der Support nach eigener Aussage noch keine Kenntnisse zur neuen Frederix hatte.",
    "es fehlt ein ap sowie min. 2 kaltgerätekabel und die tastatur und maus für das lili": "Es fehlten ein Access Point (AP), mindestens zwei Kaltgerätekabel sowie die Tastatur und die Maus für das LILI.",
    "es wurden kabellängen von 95m gemessen (an flexpos weiter gemeldet)": "Es wurden Kabellängen von 95 m gemessen und an FlexPos weitergemeldet.",
    "hebebühnen können nicht rausgefahren werden da der eingangsbereich noch nicht fertig ist": "Die Hebebühnen konnten nicht aus der Filiale gefahren werden, da der Eingangsbereich noch nicht fertiggestellt war.",
    "klärung elektriker wegen pze und headsetkanal und xweb": "Organisatorische Abstimmung mit dem Elektriker bezüglich PZE, Headsetkanal sowie XWEB durchgeführt.",
    "weiterhin kein strom in der filiale": "Weiterhin kein Strom in der Filiale."
  }
};
