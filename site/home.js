// Progressive enhancement: without JavaScript every sample stays visible.
const cards = [...document.querySelectorAll(".sample")];
const filters = [...document.querySelectorAll("[data-filter]")];
const more = document.getElementById("show-all");
const count = document.getElementById("sample-count");
let category = "All";
let expanded = false;
function render() {
  const matching = cards.filter(
    (card) => category === "All" || card.dataset.category === category,
  );
  const visible = expanded ? matching : matching.slice(0, 6);
  for (const card of cards) card.hidden = !visible.includes(card);
  for (const button of filters)
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.filter === category),
    );
  more.hidden = expanded || matching.length <= 6;
  count.textContent = `${visible.length} of ${matching.length} samples`;
}
for (const button of filters)
  button.addEventListener("click", () => {
    category = button.dataset.filter;
    expanded = false;
    render();
  });
more.addEventListener("click", () => {
  const next = cards.find(
    (card) =>
      card.hidden && (category === "All" || card.dataset.category === category),
  );
  expanded = true;
  render();
  next?.querySelector("a")?.focus({ preventScroll: true });
});
render();
const tools = document.querySelector(".tools");
document.addEventListener("click", (event) => {
  if (!tools.contains(event.target)) tools.open = false;
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && tools.open) {
    tools.open = false;
    tools.querySelector("summary").focus();
  }
});

const tutorial = document.getElementById("box-tutorial");
document
  .querySelector("[data-replay-tutorial]")
  .addEventListener("click", () => {
    tutorial.currentTime = 0;
    tutorial.play().catch(() => tutorial.focus());
  });
