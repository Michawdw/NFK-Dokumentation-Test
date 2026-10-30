/* korrekturspeicher.js – Merkzettel für den Button „Texte korrigieren“.
   Satzpaare „Originalzeile -> richtige Zeile“, die vor den Regeln aus textregeln.js gelten.
   Diese Datei wird vom AVL-Tool (Reiter „Bautagebuch-Texte“, Button „Merkzettel für die App
   speichern“) erzeugt und von Hand in den Ordner js/ kopiert – nicht von Hand bearbeiten.
   Danach tools/make_deploy.py starten: erhöht die Version, wenn sich der Merkzettel geändert hat.
   Erzeugt am 30.10.2026 08:22, 18 Einträge.
*/
var KORREKTURSPEICHER = {
  "stand": "2026-10-30",
  "taetigkeiten": {
    "ablängen der datenkabel:service kasse,sco kassen 1-6,exit gate, kasse 1-3,reserve kasse,cctv 1+2, aktenraum,kleinverteiler,ap4,headsetkanal, pze,ic1,ic2": "Ablängen der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, Aktenraum, Kleinverteiler (KV), Access Point (AP) 4, Headsetkanal, PZE, I.C. 1 sowie I.C. 2 durchgeführt.",
    "abschelen der steigetrasse über dem serverraum": "Abschelen der Steigetrasse über dem Serverraum.",
    "aktenraum,kleinverteiler,ap4,pze, headsetkanal": "Kabelzug der Datenleitungen für Aktenraum, Kleinverteiler (KV), Access Point (AP) 4, PZE sowie Headsetkanal durchgeführt.",
    "arbeiten an den netzwerkschränken (nws) abgeschlossen. patchpanels fertiggestellt, leerpanels eingebaut sowie die erdungsfahnen der patchpanels angeschlossen": "Arbeiten an den Netzwerkschränken (NWS) abgeschlossen. Patchpanels fertiggestellt, Leerpanels eingebaut sowie die Erdungsfahnen der Patchpanels angeschlossen.",
    "arbeiten an den netzwerkschränken(datenleitungen panelweise in die schränke eingeführt, keystonemodule aufgelegt) durchgeführt": "Arbeiten an den Netzwerkschränken(Datenleitungen Panelweise in die Schränke eingeführt, Keystone-Module aufgelegt)",
    "ausbau: büro, vocovo1, kabelbinder entfernen + steigtrassen abschellen": "Ausbau der Datendosen für Büro sowie VoCoVo 1 durchgeführt.\nKabelbinder entfernt.\nSteigtrassen abgeschellt.",
    "checks auf die rangierkabel montiert. kabel in die nws eingeführt": "Keystone-Module auf die Rangierkabel montiert.\nKabel in die Netzwerkschränke (NWS) eingeführt.",
    "headsetkanal,pze,ic1,ic2": "Headsetkanal, PZE, I.C. 1 sowie I.C. 2 montiert.",
    "kabelzug der datenkabel:service kasse,sco kasse 1-6,exit gate,kasse 1-3,reserve kasse,cctv 1+2,ic1,ic2": "Kabelzug der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, I.C. 1 sowie I.C. 2 durchgeführt.",
    "klärung wegen lüftungsrohr im serverraum(tür lässt sich nich öffnen)": "Organisatorische Abstimmung bezüglich des Lüftungsrohres im Serverraum durchgeführt, da sich die Tür nicht öffnen ließ.",
    "kontrolle der vorgesehenen kabelwege, kabeltrassen, bereits montierten trassen, brüstungskanäle sowie der vorhandenen wand- und deckendurchbrüche": "Kontrolle der vorgesehenen Kabelwege, Kabeltrassen, bereits montierten Kabeltrassen, Brüstungskanäle sowie der vorhandenen Wand- und Deckendurchbrüche durchgeführt.",
    "material auf die baustelle geräumt außmetern der datenkabel für service kasse,sco kasse 1-6,exit gate,kasse 1-3 + reserve kasse,cctv 1+2,aktenraum,kleinverteiler,ap4": "Arbeitsmaterialien ausgeladen.\nAusmessen der Datenleitungen für Servicekasse, SCO-Kassen 1 bis 6, Exit Gate, Kasse 1 bis 3, Reservekasse, CCTV 1 und 2, Aktenraum, Kleinverteiler (KV) sowie Access Point (AP) 4 durchgeführt.",
    "stellen und ausrichten der nws": "Netzwerkschränke (NWS) aufgestellt und ausgerichtet.",
    "transferkabel beschriftet und abgelängt": "Beschriften und Ablängen der Transferkabel durchgeführt."
  },
  "behinderungen": {
    "2 techniker 1 stunde um nws in die filiale zu einzubringen": "Einbringen der Netzwerkschränke (NWS) in die Filiale.\nAVL: 2 Techniker, jeweils 1 Stunde.",
    "erschwerten kabelzug an den kassen da trassen zu na unter den holzbindern sitzt i": "Erschwerter Kabelzug im Kassenbereich, da die Trassen zu nah unter den Holzbinder montiert waren.",
    "erschwertes arbeiten aufgrund von fehlenden licht in den serverräumen. avl 1 techniler 4 stunden": "Erschwertes Arbeiten aufgrund fehlender Beleuchtung in den Serverräumen.\nAVL: 1 Techniker, 4 Stunden."
  },
  "vorkommnisse": {
    "klärung elektriker wegen pze und headsetkanal und xweb": "Organisatorische Abstimmung mit dem Elektriker bezüglich PZE, Headsetkanal sowie XWEB durchgeführt."
  }
};
