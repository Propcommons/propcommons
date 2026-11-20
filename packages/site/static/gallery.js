// Client-side filters for the catalogue. Reads only data attributes the build wrote; no network.
const form = document.getElementById("filters");
const kits = [...document.querySelectorAll("#gallery .kit")];
const count = document.getElementById("count");
const none = document.getElementById("none");
const sizes = [...document.querySelectorAll("#sizes button")];
let size = "";

function apply() {
  const words = form.elements.q.value.toLowerCase().split(/\s+/).filter(Boolean);
  const needy = form.elements.need.checked;
  const ai = form.elements.ai.value;
  let total = 0;
  for (const kit of kits) {
    let shown = 0;
    for (const cell of kit.querySelectorAll(".cell")) {
      const ok =
        (!size || cell.dataset.size === size) &&
        (!needy || cell.dataset.need) &&
        (!ai || cell.dataset.ai === ai) &&
        words.every((w) => cell.dataset.q.includes(w));
      cell.hidden = !ok;
      if (ok) shown++;
    }
    kit.hidden = shown === 0;
    kit.querySelector(".kit-count").textContent = shown;
    total += shown;
  }
  count.textContent = total;
  none.hidden = total > 0;
}

for (const button of sizes)
  button.addEventListener("click", () => {
    size = button.dataset.size;
    for (const other of sizes) other.setAttribute("aria-pressed", String(other === button));
    apply();
  });
form.addEventListener("input", apply);
form.addEventListener("change", apply);
form.addEventListener("submit", (e) => e.preventDefault());
apply();
