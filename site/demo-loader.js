// Defer the editor and its WebGL engine until the example approaches the viewport.
const demo = document.querySelector("[data-demo]");
const start = () =>
  import("../src/site/home-demo.ts")
    .then(({ mountDemo }) => mountDemo(demo))
    .catch(() => {
      demo.querySelector("[data-demo-loading]").textContent =
        "The live preview is unavailable here. Open the full studio to try this pattern.";
    });
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        start();
      }
    },
    { rootMargin: "180px" },
  );
  observer.observe(demo);
} else start();
