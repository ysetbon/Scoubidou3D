import { createRequire } from "node:module";
import path from "node:path";

const runtimeRequire = createRequire(
  "C:/Users/YonatanSetbon/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json",
);
const { chromium } = runtimeRequire("playwright");
setTimeout(() => process.exit(2), 45_000);

const browser = await chromium.launch({ headless: true });
try {
const desktop = await browser.newPage({ viewport: { width: 1200, height: 750 } });
desktop.setDefaultTimeout(10_000);
const errors = [];
desktop.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
desktop.on("pageerror", (error) => errors.push(error.message));

await desktop.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await desktop.locator("h1").waitFor();
await desktop.screenshot({
  path: path.resolve("public/screenshot.jpeg"),
  type: "jpeg",
  quality: 88,
});

const initial = {
  title: await desktop.title(),
  heading: await desktop.locator("h1").innerText(),
  projectCount: await desktop.locator(".projectGrid article").count(),
  horizontalOverflow: await desktop.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  ),
};

await desktop.getByRole("button", { name: "Beginner", exact: true }).click();
const filteredProjectCount = await desktop.locator(".projectGrid article").count();
await desktop.getByRole("button", { name: "Use Lagoon palette" }).click();
await desktop.getByRole("button", { name: "Top", exact: true }).click();
const topViewActive = await desktop.locator(".miniStage").evaluate((node) =>
  node.classList.contains("top"),
);

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
mobile.setDefaultTimeout(10_000);
await mobile.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await mobile.locator("h1").waitFor();
const mobileOverflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
);

console.log(
  JSON.stringify(
    {
      ...initial,
      filteredProjectCount,
      topViewActive,
      mobileOverflow,
      errors,
    },
    null,
    2,
  ),
);
process.exit(0);
} finally {
  await browser.close();
}
