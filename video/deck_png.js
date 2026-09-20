// Screenshot each .slide in slides.html -> deck/slide-XX.png, then compose PDF.
// Run: NODE_PATH=~/tools/demo-recorder/node_modules node deck_png.js
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const fs = require("fs");
const OUT = __dirname + "/deck";
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto("file://" + __dirname + "/slides.html", { waitUntil: "networkidle" });
  const slides = await page.$$(".slide");
  for (let i = 0; i < slides.length; i++) {
    const f = `${OUT}/slide-${String(i + 1).padStart(2, "0")}.png`;
    await slides[i].screenshot({ path: f });
    console.log("✓", f);
  }
  await browser.close();
  // compose PDF via Pillow
  execFileSync("/home/yap/Hack/BunnieX/.venv/bin/python", ["-c", `
from PIL import Image
import glob
files = sorted(glob.glob("${OUT}/slide-*.png"))
imgs = [Image.open(f).convert("RGB") for f in files]
imgs[0].save("${__dirname}/unfog-deck.pdf", save_all=True, append_images=imgs[1:], resolution=144)
print("pdf:", len(imgs), "pages")
`]);
  console.log("done →", __dirname + "/unfog-deck.pdf");
})();
