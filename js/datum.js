/* datum.js – Datumshilfen für die ganze App.

   Warum ein eigenes Modul: Bis v39 stand an acht Stellen
   `new Date().toISOString().slice(0, 10)`. Das liefert das Datum in **UTC**.
   In Deutschland (UTC+1 im Winter, UTC+2 im Sommer) ist das zwischen 00:00 und
   01:00 bzw. 02:00 Uhr Ortszeit noch der VORTAG. Wer nach Ladenschluss fertig wird
   und dann den Tag abschließt oder eine Baubehinderungsanzeige schreibt, bekäme ein
   falsches Datum – bei der Anzeige auf einem rechtsverbindlichen Schreiben.
   Deshalb wird überall aus der lokalen Zeit des Geräts gerechnet.

   Die Uhr selbst kommt vom Handy: Die App hat kein Backend und keine Zeitquelle im
   Netz. Ist das Handy falsch gestellt, dokumentiert die App falsch.

   Das Modul wird als erstes geladen und hängt von nichts ab. */
const Datum = (() => {
  const zwei = (n) => String(n).padStart(2, '0');

  // 'YYYY-MM-DD' aus der lokalen Zeit (Format der <input type="date">-Felder).
  function heute(d) {
    const t = d || new Date();
    return t.getFullYear() + '-' + zwei(t.getMonth() + 1) + '-' + zwei(t.getDate());
  }

  // 'YYYY_MM_DD' für Dateinamen. Ohne Argument: heute.
  function fuerDatei(iso) {
    return String(iso || heute()).replace(/-/g, '_');
  }

  return { heute, fuerDatei };
})();
