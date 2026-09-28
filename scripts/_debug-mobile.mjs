import { chromium } from "playwright-core";

const browser = await chromium.launch({
  headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
});
const page = await context.newPage();
await page.goto("http://localhost:3002/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const data = await page.evaluate(() => {
  const visible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const clipped = /rect\(0(?:px)?, ?0(?:px)?, ?0(?:px)?, ?0(?:px)?\)/.test(s.clip || "");
    return !clipped && s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
  };
  const controls = [...document.querySelectorAll('button, a[href], input, textarea, select, [role="tab"]')]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
      return {
        label,
        tag: el.tagName.toLowerCase(),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
  return controls.filter((c) => c.h < 40 || c.w < 40);
});

console.log(JSON.stringify(data, null, 2));
await browser.close();