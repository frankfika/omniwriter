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

const sidebarInfo = await page.evaluate(() => {
  const aside = document.querySelector("aside");
  const cs = aside ? getComputedStyle(aside) : null;
  return {
    asideExists: !!aside,
    asideDisplay: cs?.display,
    asideClass: aside?.className,
    asideRect: aside?.getBoundingClientRect(),
    lgMedia: window.matchMedia("(min-width: 1024px)").matches,
    innerWidth: window.innerWidth,
  };
});
console.log("SIDEBAR:", JSON.stringify(sidebarInfo, null, 2));

await page.screenshot({ path: "/tmp/mobile-home.png", fullPage: true });
await browser.close();