/* Unfog frontend */
const $ = (s) => document.querySelector(s);
const S = { context: null, messages: [], lastFile: null, lastText: "", busy: false };

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
const LOAD_MSGS = ["Reading the document…", "Decoding the jargon…", "Hunting for deadlines…", "Checking for traps…", "Writing your action plan…"];
let loadTimer = null;

function startLoading(previewUrl) {
  show("loading");
  $("#preview-img").src = previewUrl || "";
  $(".loader-img").style.display = previewUrl ? "" : "none";
  let i = 0;
  $("#loading-msg").textContent = LOAD_MSGS[0];
  loadTimer = setInterval(() => {
    i = (i + 1) % LOAD_MSGS.length;
    $("#loading-msg").textContent = LOAD_MSGS[i];
  }, 4000);
}
function stopLoading() { clearInterval(loadTimer); }

async function analyze({ file, text }) {
  if (S.busy) return;
  S.busy = true;
  const preview = file ? URL.createObjectURL(file) : null;
  startLoading(preview);
  try {
    const fd = new FormData();
    if (file) fd.append("file", file, file.name || "doc.png");
    if (text) fd.append("text", text);
    fd.append("language", lang());
    const res = await fetch("/api/analyze", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Analysis failed");
    S.context = data;
    S.messages = [];
    renderResult(data);
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
  $("#doc-type").textContent = (a.doc_type || "document").replace(/_/g, " ");
  const [cls, label] = URG[a.urgency] || URG.medium;
  const u = $("#doc-urgency");
  u.textContent = label;
  u.className = `badge ${cls}`;
  u.title = a.urgency_reason || "";
  $("#doc-title").textContent = a.title || "Your document";
  $("#doc-sender").textContent = a.sender ? `From: ${a.sender}` : "";
  $("#doc-eli5").textContent = a.eli5 || "";
  $("#doc-summary").textContent = a.summary || "";

  const fl = $("#facts-list");
  fl.innerHTML = (a.key_facts || []).map(f =>
    `<dt>${esc(f.label)}</dt><dd>${esc(f.value)}</dd>`).join("") || "<dd>—</dd>";

  const dl = $("#deadlines-list");
  dl.innerHTML = (a.deadlines || []).map(d =>
    `<li><span class="d-date">${esc(d.date || "ASAP")}</span> — ${esc(d.what || "")}
     ${d.consequence ? `<span class="d-cons">If missed: ${esc(d.consequence)}</span>` : ""}</li>`).join("");
  $("#deadlines-card").style.display = (a.deadlines || []).length ? "" : "none";

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
  $("#raw-text").textContent = a.raw_text || "(no text extracted)";
}

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderChecklist(items) {
  const ul = $("#checklist");
  ul.innerHTML = items.map((it, i) => `
    <li data-i="${i}">
      <input type="checkbox" id="ck${i}">
      <label for="ck${i}" class="step-text">${esc(it.step)}
        ${it.detail ? `<span class="step-detail">${esc(it.detail)}</span>` : ""}
      </label>
    </li>`).join("");
  updateProgress();
  ul.querySelectorAll("input").forEach(cb => cb.addEventListener("change", () => {
    cb.closest("li").classList.toggle("done", cb.checked);
    updateProgress();
  }));
}

function updateProgress() {
  const boxes = [...document.querySelectorAll("#checklist input")];
  const done = boxes.filter(b => b.checked).length;
  $("#check-progress").style.width = boxes.length ? `${(done / boxes.length) * 100}%` : "0";
}

/* ---------- draft (SSE) ---------- */
$("#action-btns").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-kind]");
  if (!btn || S.busy) return;
  const kind = btn.dataset.kind;
  const out = $("#draft-out"), body = $("#draft-body");
  $("#draft-title").textContent = kindLabel(kind);
  out.classList.remove("hidden");
  body.classList.add("streaming");
  body.textContent = "";
  let acc = "";
  try {
    S.busy = true;
    await streamPost("/api/draft", { context: S.context, kind, language: lang() }, (d) => {
      acc += d;
      body.innerHTML = md(acc);
      out.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  } catch (e2) {
    acc += `\n\n⚠ ${e2.message}`;
    body.innerHTML = md(acc);
  } finally {
    body.classList.remove("streaming");
    S.busy = false;
  }
});

$("#copy-draft").addEventListener("click", () => {
  navigator.clipboard.writeText($("#draft-body").innerText);
  $("#copy-draft").textContent = "✓ Copied";
  setTimeout(() => $("#copy-draft").textContent = "📋 Copy", 1500);
});

/* ---------- chat ---------- */
function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<div class="bubble"></div>`;
  div.querySelector(".bubble").textContent = text;
  $("#chat-log").appendChild(div);
  div.scrollIntoView({ block: "nearest" });
  return div.querySelector(".bubble");
}

async function ask(q) {
  if (!q.trim() || S.busy || !S.context) return;
  S.messages.push({ role: "user", content: q });
  addMsg("user", q);
  const bub = addMsg("bot", "");
  bub.classList.add("streaming");
  let acc = "";
  try {
    S.busy = true;
    await streamPost("/api/chat", { context: S.context, messages: S.messages, language: lang() }, (d) => {
      acc += d;
      bub.innerHTML = md(acc);
      bub.parentElement.scrollIntoView({ block: "nearest" });
    });
    S.messages.push({ role: "assistant", content: acc });
  } catch (e) {
    bub.innerHTML = md(acc + `\n\n⚠ ${e.message}`);
  } finally {
    bub.classList.remove("streaming");
    S.busy = false;
  }
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
  const f = e.dataTransfer.files[0];
  if (f) { S.lastFile = f; S.lastText = ""; analyze({ file: f }); }
});
$("#file-input").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (f) { S.lastFile = f; S.lastText = ""; analyze({ file: f }); }
});
$("#paste-btn").addEventListener("click", () => {
  const t = $("#paste-text").value.trim();
  if (!t) return err("Paste some text first");
  S.lastText = t; S.lastFile = null;
  analyze({ text: t });
});
document.querySelectorAll("[data-sample]").forEach(b =>
  b.addEventListener("click", async () => {
    const res = await fetch(`/static/samples/${b.dataset.sample}`);
    const blob = await res.blob();
    const file = new File([blob], b.dataset.sample, { type: "image/png" });
    S.lastFile = file; S.lastText = "";
    analyze({ file });
  }));

/* language change → re-analyze current doc */
$("#lang").addEventListener("change", () => {
  if (S.context && !S.busy) {
    if (S.lastFile) analyze({ file: S.lastFile });
    else if (S.lastText) analyze({ text: S.lastText });
  }
});

$("#new-doc-btn").addEventListener("click", () => {
  S.context = null; S.messages = [];
  $("#file-input").value = ""; $("#paste-text").value = "";
  show("upload");
});

$("#speak-btn").addEventListener("click", () => {
  const u = new SpeechSynthesisUtterance($("#doc-summary").textContent);
  speechSynthesis.speak(u);
});
