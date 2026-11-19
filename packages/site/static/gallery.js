// Client-side filters for the gallery. Reads only data attributes the build wrote; no network.
const form = document.getElementById("filters");
const cards = [...document.querySelectorAll("#gallery .card")];
const count = document.getElementById("count");

const kits = [...document.querySelectorAll(".kit-chip")];
for (const b of kits)
  b.addEventListener("click", () => {
    form.elements.tag.value = b.dataset.kit;
    apply();
  });

function apply() {
  const tag = form.elements.tag.value;
  for (const b of kits) b.setAttribute("aria-pressed", String(b.dataset.kit === tag));
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
