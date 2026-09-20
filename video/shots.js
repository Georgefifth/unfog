// Devpost gallery screenshots — 1500x1000 (3:2). Run:
//   NODE_PATH=~/tools/demo-recorder/node_modules node shots.js
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = __dirname + "/gallery";
fs.mkdirSync(OUT, { recursive: true });

const APP = "http://localhost:8000";
const DEMO = `${APP}/?demo=bill`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log("✓", name);
  };

  // 1. landing
  await page.goto(APP, { waitUntil: "networkidle" });
  await shot("01-landing");

  // 2. result top — doc preview + legitimacy + summary
  await page.goto(DEMO, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#doc-title", { timeout: 15000 });
  await page.waitForTimeout(900);
  await shot("02-result-top");

  // 3. bbox highlights visible on doc preview (hover flash one fact)
  await page.hover("#facts-list dd[data-ref='f0']").catch(() => {});
  await page.evaluate(() => document.querySelector(".doc-head").scrollIntoView());
  await shot("03-grounding");

  // 4. deadlines + red flags
  await page.evaluate(() => document.querySelector("#deadlines-card").scrollIntoView({ block: "start" }));
  await shot("04-deadlines-flags");

  // 5. checklist + action draft (demo fake-stream)
  await page.evaluate(() => document.querySelector(".chat-card").scrollIntoView());
  await page.click("#action-btns [data-kind]");
  await page.waitForSelector("#draft-body p", { timeout: 30000 });
  await page.waitForTimeout(8000); // let letter fill in
  await page.evaluate(() => document.querySelector("#draft-out").scrollIntoView({ block: "center" }));
  await shot("05-draft");

  // 6. roleplay call
  await page.click("#roleplay-btn");
  await page.waitForSelector(".msg.bot .bubble", { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot("06-roleplay");

  // 7. scam verdict — paste a fake scam text, real analyze call
  await page.goto(APP, { waitUntil: "domcontentloaded" });
  await page.fill("#paste-text",
    "URGENT: Your vehicle has an unpaid parking violation. Pay $250 IMMEDIATELY via Bitcoin or gift cards to avoid ARREST within 24 hours. Click http://pay-ticket-now.xyz or call now.");
  await page.click("#paste-btn");
  await page.waitForSelector("#legit-card:not(.hidden)", { timeout: 120000 });
  await page.waitForSelector("#doc-title", { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector(".doc-head").scrollIntoView());
  await shot("07-scam-check");

  await browser.close();
  console.log("done →", OUT);
})();
