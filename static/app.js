/* Unfog frontend */
const $ = (s) => document.querySelector(s);
const S = { context: null, messages: [], lastFiles: [], lastText: "", busy: false,
            mode: "qa", docId: null, previewUrl: null, lastKind: "", lastDraft: "" };

const VIEWS = { upload: $("#upload-view"), loading: $("#loading-view"), result: $("#result-view") };
const lang = () => $("#lang").value;

function show(name) {
  Object.values(VIEWS).forEach(v => v.classList.add("hidden"));
  VIEWS[name].classList.remove("hidden");
  window.scrollTo({ top: 0 });
}

function err(msg) {
  const b = $("#error-banner");
  b.textContent = msg;
  b.classList.remove("hidden");
  setTimeout(() => b.classList.add("hidden"), 6000);
}

/* ---------- tiny markdown ---------- */
function md(src) {
  const esc = src.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t) => t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const lines = esc.split("\n");
  let html = "", list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^#{2,3}\s/.test(line)) { close(); html += `<h3>${inline(line.replace(/^#+\s*/, ""))}</h3>`; }
    else if (/^\s*[-*]\s+/.test(line)) { if (list !== "ul") { close(); html += "<ul>"; list = "ul"; } html += `<li>${inline(line.replace(/^\s*[-*]\s+/, ""))}</li>`; }
    else if (/^\s*\d+[.)]\s+/.test(line)) { if (list !== "ol") { close(); html += "<ol>"; list = "ol"; } html += `<li>${inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>`; }
    else if (!line.trim()) { close(); }
    else { close(); html += `<p>${inline(line)}</p>`; }
  }
  close();
  return html;
}

/* ---------- streaming POST helper ---------- */
async function streamPost(url, body, onDelta) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2);
      const m = frame.match(/^data: (.*)$/s);
      if (!m) continue;
      const obj = JSON.parse(m[1]);
      if (obj.delta) onDelta(obj.delta);
      if (obj.error) throw new Error(obj.error);
    }
  }
}

/* ---------- analyze ---------- */
const LOAD_MSGS = ["Reading the document…", "Decoding the jargon…", "Hunting for deadlines…", "Checking for traps…", "Sniffing for scam signals…", "Writing your action plan…"];
let loadTimer = null;

function startLoading(previewUrl, nfiles = 0, firstFile = null) {
  show("loading");
  const wrap = $(".loader-img");
  if (previewUrl) {
    wrap.innerHTML = `<img id="preview-img" alt="document preview">`;
    $("#preview-img").src = previewUrl;
    wrap.style.display = "";
  } else if (firstFile) {
    wrap.innerHTML = `<div class="pdf-placeholder">📄<span>${esc(firstFile.name)}${nfiles > 1 ? ` +${nfiles - 1} more` : ""}</span></div>`;
    wrap.style.display = "";
  } else {
    wrap.style.display = "none";
  }
  const t0 = Date.now();
  let i = 0;
  $("#loading-msg").textContent = LOAD_MSGS[0];
  $("#elapsed").textContent = "0";
  loadTimer = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    $("#elapsed").textContent = s;
    if (s % 4 === 0) {
      i = (i + 1) % LOAD_MSGS.length;
      $("#loading-msg").textContent = LOAD_MSGS[i];
    }
  }, 1000);
}
function stopLoading() { clearInterval(loadTimer); }

async function analyze({ files, text }) {
  if (S.busy) return;
  S.busy = true;
  const first = (files || [])[0];
  S.previewUrl = first && first.type.startsWith("image/") ? URL.createObjectURL(first) : null;
  startLoading(S.previewUrl, files?.length || 0, first);
  try {
    const fd = new FormData();
    for (const f of files || []) fd.append("files", f, f.name || "doc.png");
    if (text) fd.append("text", text);
    fd.append("language", lang());
    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Analysis failed");
    data._preview = S.previewUrl;
    S.context = data;
    S.messages = [];
    S.mode = "qa";
    renderResult(data);
    saveHistory(data);
    show("result");
  } catch (e) {
    err(e.message);
    show("upload");
  } finally {
    stopLoading();
    S.busy = false;
  }
}

/* ---------- render result ---------- */
const KIND_LABEL = {
  dispute_letter: "✉️ Draft a dispute letter",
  appeal_letter: "✉️ Draft an appeal",
  reply_letter: "✉️ Draft a reply",
  phone_script: "📞 Phone call script",
  questions_to_ask: "❓ Questions to ask",
};
const kindLabel = (k) => KIND_LABEL[k] || `✉️ ${k.replace(/_/g, " ")}`;
const URG = { low: ["urg-low", "Low urgency"], medium: ["urg-medium", "Needs attention"], high: ["urg-high", "Urgent"] };

function renderResult(a) {
  S.docId = a._id || (a._id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  S.mode = "qa";
  $("#roleplay-banner").classList.add("hidden");
  $("#chat-title").textContent = "💬 Ask about this document";
  $("#doc-type").textContent = (a.doc_type || "document").replace(/_/g, " ");
  const [cls, label] = URG[a.urgency] || URG.medium;
  const u = $("#doc-urgency");
  u.textContent = label;
  u.className = `badge ${cls}`;
  u.title = a.urgency_reason || "";
  $("#doc-title").textContent = a.title || "Your document";
  $("#doc-sender").textContent = a.sender ? `From: ${a.sender}` : "";
  $("#doc-eli5").textContent = a.eli5 || "";

  // doc preview + grounding boxes (bbox normalized 0-1000)
  const dv = $("#doc-view");
  if (a._preview) {
    dv.classList.remove("hidden");
    $("#doc-thumb").src = a._preview;
    const layer = $("#bbox-layer");
    layer.innerHTML = "";
    const boxed = [];
    (a.key_facts || []).forEach((f, i) => { if (okBox(f.bbox)) boxed.push({ b: f.bbox, ref: `f${i}` }); });
    (a.deadlines || []).forEach((d, i) => { if (okBox(d.bbox)) boxed.push({ b: d.bbox, ref: `d${i}` }); });
    boxed.forEach(({ b, ref }) => {
      const el = document.createElement("div");
      el.className = "bbox";
      el.dataset.ref = ref;
      el.style.cssText = `left:${b[0] / 10}%;top:${b[1] / 10}%;width:${(b[2] - b[0]) / 10}%;height:${(b[3] - b[1]) / 10}%`;
      layer.appendChild(el);
    });
  } else {
    dv.classList.add("hidden");
  }
  $("#doc-summary").textContent = a.summary || "";

  const lg = a.legitimacy || {};
  const legitCard = $("#legit-card");
  if (lg.verdict && lg.verdict !== "unclear") {
    const v = $("#legit-verdict");
    v.textContent = lg.verdict === "likely_legit" ? "✓ Looks legitimate" : "⚠️ Suspicious — verify before paying";
    v.className = `legit-verdict ${lg.verdict === "likely_legit" ? "ok" : "sus"}`;
    $("#legit-signals").innerHTML = (lg.signals || []).map(s => `<li>${esc(s)}</li>`).join("");
    legitCard.classList.remove("hidden");
  } else {
    legitCard.classList.add("hidden");
  }

  const fl = $("#facts-list");
  fl.innerHTML = (a.key_facts || []).map((f, i) =>
    `<dt data-ref="f${i}">${esc(f.label)}</dt><dd data-ref="f${i}">${esc(f.value)}</dd>`)
    .join("") || "<dd>—</dd>";

  const dl = $("#deadlines-list");
  dl.innerHTML = (a.deadlines || []).map((d, i) => {
    const chip = daysChip(d.date);
    return `<li data-ref="d${i}">
      <div class="d-top">
        <span class="d-date">${esc(d.date || "ASAP")}</span>${chip}
        ${d.date ? `<button class="mini-btn cal-btn" data-dl="${i}" title="Add to calendar">📅</button>` : ""}
      </div>
      ${esc(d.what || "")}
      ${d.consequence ? `<span class="d-cons">If missed: ${esc(d.consequence)}</span>` : ""}
    </li>`;
  }).join("");
  $("#deadlines-card").style.display = (a.deadlines || []).length ? "" : "none";

  // hover a fact/deadline → flash its bbox on the document
  document.querySelectorAll("[data-ref]").forEach(el => {
    el.addEventListener("mouseenter", () => {
      document.querySelectorAll(".bbox").forEach(b =>
        b.classList.toggle("hot", b.dataset.ref === el.dataset.ref));
    });
    el.addEventListener("mouseleave", () =>
      document.querySelectorAll(".bbox").forEach(b => b.classList.remove("hot")));
  });

  const gf = $("#flags-list");
  gf.innerHTML = (a.red_flags || []).map(f =>
    `<li><strong>${esc(f.flag)}</strong><span class="f-why">${esc(f.why)}</span></li>`).join("");
  $("#flags-card").classList.toggle("hidden", !(a.red_flags || []).length);

  renderChecklist(a.checklist || []);

  const acts = (a.suggested_actions || []).slice(0, 4);
  $("#action-btns").innerHTML = acts.map(k =>
    `<button class="btn secondary" data-kind="${k}">${kindLabel(k)}</button>`).join("");
  $("#draft-out").classList.add("hidden");
  $("#chat-log").innerHTML = "";
  $("#raw-text").value = a.raw_text || "";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const okBox = (b) => Array.isArray(b) && b.length === 4 && b.every(n => typeof n === "number")
  && b[2] > b[0] && b[3] > b[1] && b.every(n => n >= 0 && n <= 1000);

function renderChecklist(items) {
  const saved = loadChecks();
  const ul = $("#checklist");
  ul.innerHTML = items.map((it, i) => `
    <li data-i="${i}" class="${saved[i] ? "done" : ""}">
      <input type="checkbox" id="ck${i}" ${saved[i] ? "checked" : ""}>
      <label for="ck${i}" class="step-text">${esc(it.step)}
        ${it.detail ? `<span class="step-detail">${esc(it.detail)}</span>` : ""}
      </label>
      <button class="mini-btn how-btn" data-step="${i}" title="How do I do this?">💬</button>
    </li>`).join("");
  ul.querySelectorAll(".how-btn").forEach(b => b.addEventListener("click", () => {
    const step = items[+b.dataset.step];
    setRoleplay(false);
    sendChat(`How exactly do I do this step: "${step.step}${step.detail ? " — " + step.detail : ""}"? Walk me through it.`, false);
    $(".chat-card").scrollIntoView({ behavior: "smooth" });
  }));
  updateProgress();
  ul.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
    cb.closest("li").classList.toggle("done", cb.checked);
    updateProgress();
    saveChecks();
  }));
}

function updateProgress() {
  const boxes = [...document.querySelectorAll("#checklist input")];
  const done = boxes.filter(b => b.checked).length;
  $("#check-progress").style.width = boxes.length ? `${(done / boxes.length) * 100}%` : "0";
}

/* ---------- deadlines: countdown + ICS ---------- */
function daysChip(dateStr) {
  const t = new Date(dateStr + "T00:00:00");
  if (isNaN(t)) return "";
  const days = Math.ceil((t - Date.now()) / 86400000);
  const [txt, cls] = days < 0 ? [`${-days}d overdue`, "over"] :
                     days === 0 ? ["today", "soon"] :
                     days <= 7 ? [`${days}d left`, "soon"] : [`${days}d left`, "ok"];
  return `<span class="d-chip ${cls}">${txt}</span>`;
}

function downloadIcs(d, title) {
  const dt = (d.date || "").replaceAll("-", "");
  if (!/^\d{8}$/.test(dt)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const body = [d.what || "", d.consequence ? `If missed: ${d.consequence}` : "", "— via Unfog"].join("\\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Unfog//BunnieX//EN",
    "BEGIN:VEVENT", `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@unfog`,
    `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${dt}`,
    `SUMMARY:${(title || "Document deadline")} — ${d.what || "deadline"}`,
    `DESCRIPTION:${body.replace(/[\r\n]/g, "\\n")}`,
    "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "deadline.ics" });
  a.click();
  URL.revokeObjectURL(url);
}

$("#deadlines-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-dl]");
  if (b && S.context) downloadIcs(S.context.deadlines[+b.dataset.dl], S.context.title);
});

/* ---------- local history ---------- */
const HKEY = "unfog_history";
const hist = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };

function saveHistory(a) {
  try {
    const h = hist().filter(x => x.id !== a._id);
    h.unshift({ id: a._id, title: a.title, doc_type: a.doc_type, ts: Date.now(), a });
    localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 8)));
  } catch {
    try { // quota: retry without the bulky transcript
      const slim = { ...a }; delete slim.raw_text;
      const h = hist().filter(x => x.id !== a._id);
      h.unshift({ id: a._id, title: a.title, doc_type: a.doc_type, ts: Date.now(), a: slim });
      localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 8)));
    } catch { /* storage full/disabled — skip history */ }
  }
}

function renderHistory() {
  const h = hist();
  $("#history-list").innerHTML = h.length ? h.map(x => `
    <li data-id="${x.id}">
      <span class="h-type">${esc((x.doc_type || "doc").replace(/_/g, " "))}</span>
      <span class="h-title">${esc(x.title || "Untitled")}</span>
      <span class="h-ts">${new Date(x.ts).toLocaleString()}</span>
    </li>`).join("") : `<li class="h-empty">No documents yet</li>`;
}

$("#history-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  renderHistory();
  $("#history-panel").classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#history-panel") && !e.target.closest("#history-btn"))
    $("#history-panel").classList.add("hidden");
});
$("#history-list").addEventListener("click", (e) => {
  const li = e.target.closest("[data-id]");
  if (!li) return;
  const item = hist().find(x => x.id === li.dataset.id);
  if (!item) return;
  S.context = item.a;
  S.messages = [];
  renderResult(item.a);
  $("#history-panel").classList.add("hidden");
  show("result");
});
$("#history-clear").addEventListener("click", () => {
  localStorage.removeItem(HKEY);
  renderHistory();
});

/* ---------- export brief ---------- */
$("#export-btn").addEventListener("click", () => {
  const a = S.context;
  if (!a) return;
  const lines = [
    `# ${a.title || "Document brief"}`, ``,
    `**Type:** ${a.doc_type || "-"}  `, `**From:** ${a.sender || "-"}  `,
    `**Urgency:** ${a.urgency || "-"} — ${a.urgency_reason || ""}`, ``,
    `## In plain words`, a.summary || "", ``,
    a.eli5 ? `**In one sentence:** ${a.eli5}` : "", ``,
    `## Key facts`, ...(a.key_facts || []).map(f => `- **${f.label}:** ${f.value}`), ``,
    `## Deadlines`, ...(a.deadlines || []).map(d =>
      `- **${d.date || "ASAP"}** — ${d.what}${d.consequence ? ` (if missed: ${d.consequence})` : ""}`), ``,
    `## Watch out`, ...(a.red_flags || []).map(f => `- **${f.flag}** — ${f.why}`), ``,
    a.legitimacy?.verdict ? `## Legitimacy: ${a.legitimacy.verdict}` : "",
    ...(a.legitimacy?.signals || []).map(s => `- ${s}`), ``,
    `## Action checklist`, ...(a.checklist || []).map((c, i) => `${i + 1}. ${c.step}${c.detail ? ` — ${c.detail}` : ""}`),
    ``, `---`, `Generated by Unfog · not legal/medical/financial advice`];
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: "unfog-brief.md" }).click();
  URL.revokeObjectURL(url);
});

/* ---------- checklist persistence ---------- */
function ckKey() { return `unfog_ck_${S.docId}`; }
function loadChecks() { try { return JSON.parse(localStorage.getItem(ckKey())) || []; } catch { return []; } }
function saveChecks() {
  const arr = [...document.querySelectorAll("#checklist input")].map(b => b.checked ? 1 : 0);
  try { localStorage.setItem(ckKey(), JSON.stringify(arr)); } catch { }
}

/* ---------- roleplay ---------- */
function setRoleplay(on) {
  const target = on ? "roleplay" : "qa";
  const changed = S.mode !== target;
  S.mode = target;
  $("#roleplay-banner").classList.toggle("hidden", !on);
  $("#chat-title").textContent = on ? "🎭 Practice call" : "💬 Ask about this document";
  if (changed) { $("#chat-log").innerHTML = ""; S.messages = []; }
  if (on && changed) {
    $("#rp-org").textContent = S.context?.sender || "the organization";
    sendChat("(the phone rings — the rep picks up)", true);
  }
}
$("#roleplay-btn").addEventListener("click", () => setRoleplay(true));
$("#roleplay-exit").addEventListener("click", () => { speechSynthesis.cancel(); setRoleplay(false); });

/* ---------- voice ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, recOn = false;
if (!SR) {
  $("#mic-btn").style.display = "none";
} else {
  rec = new SR();
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  rec.onresult = (e) => {
    const t = e.results[0][0].transcript;
    if (S.mode === "roleplay") { sendChat(t, false); }
    else { $("#chat-input").value = t; }
  };
  rec.onend = () => { recOn = false; $("#mic-btn").classList.remove("rec"); };
  rec.onerror = () => { recOn = false; $("#mic-btn").classList.remove("rec"); };
}
$("#mic-btn").addEventListener("click", () => {
  if (!rec) return;
  if (recOn) { rec.stop(); return; }
  rec.lang = ({ en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", es: "es-ES",
                fr: "fr-FR", pt: "pt-BR", hi: "hi-IN", ar: "ar-SA", vi: "vi-VN",
                de: "de-DE", ru: "ru-RU" })[lang()] || "en-US";
  try { rec.start(); recOn = true; $("#mic-btn").classList.add("rec"); }
  catch { /* already started */ }
});

function speak(text) {
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[*#_`]/g, ""));
  u.lang = ({ en: "en-US", zh: "zh-CN", ja: "ja-JP", ko: "ko-KR", es: "es-ES",
              fr: "fr-FR", pt: "pt-BR", hi: "hi-IN", ar: "ar-SA", vi: "vi-VN",
              de: "de-DE", ru: "ru-RU" })[lang()] || "en-US";
  const vs = speechSynthesis.getVoices().find(v => v.lang.startsWith(u.lang.slice(0, 2)));
  if (vs) u.voice = vs;
  speechSynthesis.speak(u);
}

/* ---------- draft (SSE) ---------- */
async function runDraft(kind, refine = "") {
  const out = $("#draft-out"), body = $("#draft-body");
  $("#draft-title").textContent = kindLabel(kind) + (refine ? " · revised" : "");
  out.classList.remove("hidden");
  body.classList.add("streaming");
  body.textContent = "";
  let acc = "";
  try {
    S.busy = true;
    await streamPost("/api/draft", {
      context: S.context, kind, language: lang(),
      refine, previous: refine ? S.lastDraft : "",
    }, (d) => {
      acc += d;
      body.innerHTML = md(acc);
      out.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    S.lastKind = kind;
    S.lastDraft = acc;
  } catch (e2) {
    acc += `\n\n⚠ ${e2.message}`;
    body.innerHTML = md(acc);
  } finally {
    body.classList.remove("streaming");
    S.busy = false;
  }
}

$("#action-btns").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-kind]");
  if (btn && !S.busy) runDraft(btn.dataset.kind);
});

$("#refine-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#refine-input").value.trim();
  if (!v || S.busy || !S.lastKind) return;
  $("#refine-input").value = "";
  runDraft(S.lastKind, v);
});

$("#copy-draft").addEventListener("click", () => {
  navigator.clipboard.writeText($("#draft-body").innerText);
  $("#copy-draft").textContent = "✓ Copied";
  setTimeout(() => $("#copy-draft").textContent = "📋 Copy", 1500);
});

/* ---------- chat ---------- */
function addMsg(role, text, hidden) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="bubble"></div>`;
  div.querySelector(".bubble").textContent = text;
  if (hidden) div.style.display = "none";
  $("#chat-log").appendChild(div);
  div.scrollIntoView({ block: "nearest" });
  return div.querySelector(".bubble");
}

async function sendChat(q, hidden) {
  if (!q.trim() || S.busy || !S.context) return;
  S.messages.push({ role: "user", content: q });
  if (!hidden) addMsg("user", q);
  const bub = addMsg("bot", "");
  bub.classList.add("streaming");
  let acc = "";
  try {
    S.busy = true;
    await streamPost("/api/chat", {
      context: S.context, messages: S.messages, language: lang(), mode: S.mode,
    }, (d) => {
      acc += d;
      bub.innerHTML = md(acc);
      bub.parentElement.scrollIntoView({ block: "nearest" });
    });
    S.messages.push({ role: "assistant", content: acc });
    if (S.mode === "roleplay" && acc) speak(acc);
    else renderFollowups();
  } catch (e) {
    bub.innerHTML = md(acc + `\n\n⚠ ${e.message}`);
  } finally {
    bub.classList.remove("streaming");
    S.busy = false;
  }
}
const ask = (q) => sendChat(q, false);

/* contextual follow-up suggestions after each answer */
const FOLLOWUPS = {
  medical_bill: ["Is every charge here legit?", "How do I ask for an itemized bill?", "What if I can't afford this?"],
  parking_ticket: ["What's my best excuse to contest?", "How do I prove the meter was broken?", "Will this affect my license?"],
  lease: ["Is this increase even legal?", "Can I negotiate?", "What are my rights here?"],
  rent: ["Is this increase even legal?", "Can I negotiate?", "What are my rights here?"],
  insurance: ["How strong is my appeal case?", "What evidence should I attach?", "Can my doctor appeal for me?"],
  rejection_letter: ["How strong is my appeal case?", "What evidence should I attach?"],
};
function renderFollowups() {
  if (S.mode !== "qa") return;
  const dt = (S.context?.doc_type || "other");
  const qs = FOLLOWUPS[dt] || FOLLOWUPS[Object.keys(FOLLOWUPS).find(k => dt.includes(k))] ||
    ["What should I do first?", "What's the worst that can happen?", "Who can help me with this?"];
  const row = $("#ask-chips");
  row.innerHTML = qs.map(q => `<button class="chip small" data-q="${esc(q)}">${esc(q)}</button>`).join("");
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const inp = $("#chat-input");
  ask(inp.value);
  inp.value = "";
});
$("#ask-chips").addEventListener("click", (e) => {
  const c = e.target.closest("[data-q]");
  if (c) ask(c.dataset.q);
});

/* ---------- upload handlers ---------- */
const dz = $("#dropzone");
dz.addEventListener("click", () => $("#file-input").click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#file-input").click(); });
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
dz.addEventListener("drop", (e) => {
  e.preventDefault(); dz.classList.remove("dragover");
  const files = [...e.dataTransfer.files];
  if (files.length) { S.lastFiles = files; S.lastText = ""; analyze({ files }); }
});
$("#file-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  if (files.length) { S.lastFiles = files; S.lastText = ""; analyze({ files }); }
});
$("#paste-btn").addEventListener("click", () => {
  const t = $("#paste-text").value.trim();
  if (!t) return err("Paste some text first");
  S.lastText = t; S.lastFiles = [];
  analyze({ text: t });
});
document.querySelectorAll("[data-sample]").forEach(b =>
  b.addEventListener("click", async () => {
    const res = await fetch(`/static/samples/${b.dataset.sample}`);
    const blob = await res.blob();
    const file = new File([blob], b.dataset.sample, { type: "image/png" });
    S.lastFiles = [file]; S.lastText = "";
    analyze({ files: [file] });
  }));

/* language change → re-analyze current doc */
$("#lang").addEventListener("change", () => {
  if (S.context && !S.busy) {
    if (S.lastFiles.length) analyze({ files: S.lastFiles });
    else if (S.lastText) analyze({ text: S.lastText });
  }
});

$("#rerun-text").addEventListener("click", () => {
  const t = $("#raw-text").value.trim();
  if (!t || S.busy) return;
  S.lastText = t; S.lastFiles = []; S.previewUrl = null;
  analyze({ text: t });
});

$("#new-doc-btn").addEventListener("click", () => {
  S.context = null; S.messages = [];
  $("#file-input").value = ""; $("#paste-text").value = "";
  show("upload");
});

$("#speak-btn").addEventListener("click", () => speak($("#doc-summary").textContent));

/* ---------- demo mode: ?demo=bill|ticket|rent|denial — instant cached result ---------- */
const DEMO_MAP = { bill: "medical_bill.png", ticket: "parking_ticket.png",
                   rent: "rent_notice.png", denial: "denial_letter.png" };
const demoKey = new URLSearchParams(location.search).get("demo");
if (demoKey && DEMO_MAP[demoKey]) {
  (async () => {
    try {
      const [a, img] = await Promise.all([
        fetch(`/static/demo_cache/${demoKey}.json`).then(r => r.json()),
        fetch(`/static/samples/${DEMO_MAP[demoKey]}`).then(r => r.blob()),
      ]);
      S.previewUrl = URL.createObjectURL(img);
      a._preview = S.previewUrl;
      S.context = a;
      renderResult(a);
      show("result");
    } catch (e) { /* fall back to normal upload view */ }
  })();
}
