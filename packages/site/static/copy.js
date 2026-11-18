// Copy buttons for code snippets. Each button names the element whose text it copies.
for (const button of document.querySelectorAll("button.copy")) {
  button.addEventListener("click", async () => {
    const text = document.getElementById(button.dataset.copy)?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Select it to copy";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 1600);
  });
}
