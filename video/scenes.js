// Unfog — BunnieX Hackathon demo scenes
// record: cd ~/tools/demo-recorder && node record-demo.js /home/yap/Hack/BunnieX/video/scenes.js --out=/home/yap/Hack/BunnieX/video/out
const APP = "http://localhost:8000";
const DEMO = `${APP}/?demo=bill`;   // medical bill, cached real analysis (baked from live API)

module.exports = [
  {
    name: "title",
    card: {
      preset: "playful",
      kicker: "BunnieX Hackathon",
      title: "Unfog",
      sub: "paperwork → clarity → action",
      foot: "Powered by Featherless AI · open source",
    },
    duration: 4,
    vo: "Medical bills, tickets, leases — paperwork is written to confuse. Unfog cuts through it.",
  },
  {
    name: "upload",
    url: APP,
    actions: [
      { type: "waitFor", sel: ".sample-chips .chip" },
      { type: "hover", sel: "[data-sample='medical_bill.png']" },
      { type: "wait", ms: 700 },
      { type: "click", sel: "[data-sample='medical_bill.png']" },
      { type: "waitFor", sel: "#loading-view:not(.hidden)", timeout: 15000 },
      { type: "wait", ms: 3200 },
    ],
    vo: "Drop a photo, a PDF, or just paste the text. A vision model reads the actual page.",
  },
  {
    name: "result",
    url: DEMO,
    actions: [
      { type: "waitFor", sel: "#doc-title", timeout: 15000 },
      { type: "wait", ms: 1600 },
      { type: "scrollIntoView", sel: "#facts-card" },
      { type: "hover", sel: "#facts-list dd[data-ref='f0']" },
      { type: "wait", ms: 1400 },
      { type: "hover", sel: "#facts-list dd[data-ref='f3']" },
      { type: "wait", ms: 1200 },
    ],
    vo: "In seconds: what it says in plain words, the key facts — and exactly where they sit on the page.",
  },
  {
    name: "trust",
    url: DEMO,
    actions: [
      { type: "waitFor", sel: "#legit-card", timeout: 15000 },
      { type: "scrollIntoView", sel: "#legit-card" },
      { type: "wait", ms: 1800 },
      { type: "scrollIntoView", sel: "#deadlines-card" },
      { type: "wait", ms: 1800 },
    ],
    vo: "It checks whether the document itself looks like a scam, counts down every deadline, and exports them to your calendar.",
  },
  {
    name: "action",
    url: DEMO,
    actions: [
      { type: "waitFor", sel: "#action-btns [data-kind]", timeout: 15000 },
      { type: "scrollIntoView", sel: "#action-btns" },
      { type: "click", sel: "#action-btns [data-kind]" },
      { type: "waitFor", sel: "#draft-out:not(.hidden)", timeout: 15000 },
      { type: "wait", ms: 9000 },
    ],
    vo: "Then it acts — drafting a dispute letter pre-filled with every real number from your bill.",
  },
  {
    name: "roleplay",
    url: DEMO,
    actions: [
      { type: "waitFor", sel: "#roleplay-btn", timeout: 15000 },
      { type: "scrollIntoView", sel: ".chat-card" },
      { type: "click", sel: "#roleplay-btn" },
      { type: "waitFor", sel: ".msg.bot .bubble", timeout: 30000 },
      { type: "wait", ms: 6000 },
    ],
    vo: "And before you dial, rehearse the call — even by voice — against an AI playing their billing desk.",
  },
  {
    name: "endcard",
    card: {
      preset: "playful",
      kicker: "Unfog · open source",
      title: "Nobody should lose money to fine print.",
      foot: "github.com/Georgefifth/unfog · live demo: unfog-oaye.onrender.com",
    },
    duration: 4,
    vo: "Unfog. Because nobody should lose money to fine print.",
  },
];
