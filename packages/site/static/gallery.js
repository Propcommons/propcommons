// Client-side filters for the gallery. Reads only data attributes the build wrote; no network.
const form = document.getElementById("filters");
const cards = [...document.querySelectorAll("#gallery .card")];
const count = document.getElementById("count");

function apply() {
  const tag = form.elements.tag.value;
  const size = form.elements.size.value;
  const ai = form.elements.ai.value;
  let shown = 0;
  for (const card of cards) {
    const ok =
      (!tag || card.dataset.tags.split(" ").includes(tag)) &&
      (!size || card.dataset.size === size) &&
      (!ai || card.dataset.ai === ai);
    card.hidden = !ok;
    if (ok) shown++;
  }
  count.textContent = `${shown} of ${cards.length} shown`;
}

form.addEventListener("change", apply);
apply();
