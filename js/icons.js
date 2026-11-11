/* Icons (ab v84) – reine Darstellungshilfe, keine Logik.
   Liefert das Markup für ein Lucide-Icon aus dem Sprite oben in index.html
   (<symbol id="i-NAME">). Strichstärke/Farbe kommen aus der CSS-Klasse .i
   (currentColor) – das Icon nimmt also immer die Textfarbe seines Knopfs an. */
const Icon = (name, cls) =>
  `<svg class="i${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;
