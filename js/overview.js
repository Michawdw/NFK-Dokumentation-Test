/* overview.js – berechnet Ist-Anzahl/Status je Knoten und rendert die
   Übersicht offener/erledigter Positionen. */
const Overview = (() => {

  // Reichert Knoten mit ist (Anzahl Bilder) und done (ist >= pflicht) an.
  // Ist = übernommene Vor-Anzahl (priorCount) + lokal aufgenommene Bilder.
  async function enrich(nodes) {
    const job = App.getCurrentJob();
    const counts = await Promise.all(nodes.map((n) => DB.countPhotos(job.id, n.key)));
    return nodes.map((n, i) => {
      const prior = (job.priorCounts && job.priorCounts[n.key]) || 0;
      const local = counts[i];
      const ist = prior + local;
      return { ...n, ist, prior, local, done: ist >= n.pflicht, skipped: Structure.isSkipped(n, job) };
    });
  }

  // Baut HTML für die Übersicht: nach Ober/Unter gruppiert, offen zuerst markiert.
  function buildHtml(enriched) {
    // Geskippte („nicht benötigt") Positionen zählen nicht als offen/erledigt.
    const offen = enriched.filter((n) => !n.skipped && !n.done);
    const erledigt = enriched.filter((n) => !n.skipped && n.done);
    const nichtBenoetigt = enriched.filter((n) => n.skipped);

    const grp = Structure.groupForDisplay(enriched);
    let html = `<div class="ov-summary">
        <span class="ov-pill open">${offen.length} offen</span>
        <span class="ov-pill done">${erledigt.length} erledigt</span>
        ${nichtBenoetigt.length ? `<span class="ov-pill skip">${nichtBenoetigt.length} nicht benötigt</span>` : ''}
      </div>`;

    for (const [ober, unterMap] of grp) {
      html += `<div class="ov-ober">${esc(ober)}</div>`;
      for (const [uk, list] of unterMap) {
        if (uk) html += `<div class="ov-unter">${esc(uk)}</div>`;
        for (const n of list) {
          const cls = n.skipped ? 'ov-item skip' : (n.done ? 'ov-item done' : 'ov-item open');
          const mark = n.skipped ? '–' : (n.done ? '✓' : '○');
          const cnt = n.skipped ? 'nicht benötigt' : `${n.ist}/${n.pflicht}`;
          const priorTag = (!n.skipped && n.prior > 0)
            ? ` <span class="prior-tag" title="vom Vorteam erledigt">Vorteam: ${n.prior}</span>` : '';
          html += `<div class="${cls}">
              <span class="ov-mark">${mark}</span>
              <span class="ov-name">${esc(n.bildname)}${priorTag}</span>
              <span class="ov-cnt">${cnt}</span>
            </div>`;
        }
      }
    }
    return html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function show() {
    const nodes = await Structure.getMerged();
    if (nodes.length === 0) {
      App.toast('Noch keine Struktur – bitte Template importieren.');
      return;
    }
    const enriched = await enrich(nodes);
    App.openInfoModal('Übersicht', buildHtml(enriched));
  }

  return { enrich, buildHtml, show };
})();
