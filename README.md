---
title: Unfog
emoji: 🌫️
sdk: docker
app_port: 7860
---

# 🌫️➡️ Unfog

**Snap a photo of confusing paperwork. Get a plain-language explanation, the traps to watch for, and a ready-to-send action plan — in your own language.**

Built for the [BunnieX Hackathon](https://buuniex-hackathon.devpost.com/).

---

## The problem

Every year, millions of people get documents they can't fully understand:

- a **medical bill** full of CPT codes and "adjustments"
- a **parking ticket** with escalating fines buried in legalese
- a **rent increase notice** with an auto-renewal trap
- an **insurance denial** written to discourage appeals

The stakes are real — missed deadlines, overpaid fees, unchallenged denials. And the burden falls hardest on students, immigrants, the elderly, and anyone reading in a second language. Existing tools (search engines, generic chatbots) can *define* jargon, but they can't read *your* document, find *your* deadlines, and draft *your* reply.

## The solution

Unfog is a "paperwork decoder":

1. **📸 Snap or drop a document** — photo, scan, screenshot, **multi-page PDF**, or pasted text
2. **📖 Plain-language summary** — what it actually says, plus a one-line ELI5
3. **🔑 Key facts** — amounts, dates, reference numbers, structured
4. **⏰ Deadlines** — what happens if you miss them, countdown chips, one-tap **calendar (.ics) export**
5. **⚠️ Red flags** — hidden fees, auto-renewals, waived rights, suspicious charges
6. **🛡️ Scam check** — is this document even real? Flags gift-card demands, arrest threats, fake URLs
7. **✅ Action checklist** — concrete next steps, check them off (progress remembered)
8. **✍️ Action layer** — one tap drafts a **dispute letter**, **appeal**, **reply**, **phone script**, or **questions to ask**, pre-filled with the real facts from your document
9. **🎭 Practice the call** — rehearse the scary phone call with an AI playing the organization's rep
10. **💬 Grounded Q&A** — ask anything ("Is this a scam?", "What if I ignore it?") — answers quote your document, not generic advice
11. **🌍 12 languages** — read a Japanese hospital bill in English, or a US lease in Chinese
12. **🕘 Local history** — recent documents stay in your browser only; **export a brief** as markdown

**Privacy by design:** documents live in memory only — nothing is stored or logged.

## Demo

```bash
pip install -r requirements.txt
export FEATHERLESS_API_KEY=...     # https://featherless.ai account → API keys
python3 scripts/gen_samples.py     # optional: regenerate the 4 demo documents
python3 server.py                  # → http://localhost:8000
```

Try it instantly with the built-in samples: parking ticket, medical bill, rent-increase notice, insurance denial — or photograph any real mail.

## How it works

```
photo/text ──► FastAPI ──► Qwen3-VL (vision) ──► structured JSON analysis
                              │                    (type, facts, deadlines,
                              │                     red flags, checklist)
                              ▼
                  Qwen2.5-72B (text) ◄── chat & drafting endpoints
                  (SSE streaming)
```

- **Vision-language understanding** (`Qwen/Qwen3-VL-30B-A3B-Instruct`): reads photos of documents — including crumpled receipts and screenshots — and returns strict JSON via schema-guided prompting.
- **Grounded generation** (`Qwen/Qwen2.5-72B-Instruct`): chat answers and drafted letters are constrained to the extracted document context, quoting real amounts and reference numbers instead of hallucinating.
- **All inference via Featherless AI** serverless API — 100% open-weight models, no GPU to manage, OpenAI-compatible endpoint.
- **Resilience**: model fallback chains, cold-start retries, and upstream anomaly filtering (open models occasionally emit `!`-token floods — we detect and cut them).

## Tech stack

| Layer | Tech |
|---|---|
| AI inference | Featherless AI API — Qwen3-VL-30B (vision), Qwen2.5-72B + fallbacks (text) |
| Backend | Python 3.12, FastAPI, Server-Sent Events |
| PDF | PyMuPDF — rasterizes pages for the vision model |
| Frontend | Vanilla HTML/CSS/JS — zero build step, mobile-friendly |
| Images | Pillow preprocessing (auto-resize/re-encode) |

## Why it's innovative

- **Not another summarizer**: the action layer (dispute letters, phone scripts, checklists, calendar export) turns understanding into *doing* — closing the loop from "what does this say?" to "it's handled."
- **Trust built in**: the legitimacy check answers the question nobody else does — "is this even real?" — before you pay a fake ticket.
- **Rehearsal mode**: practicing the phone call with a realistic, bureaucratic AI rep is the feature people remember.
- **Document-agnostic**: any scary paper, any language, multiple pages — one pipeline handles a parking ticket and a Japanese medical form equally well.
- **Grounded & honest**: answers cite your document and admit when it doesn't say — critical for documents where being wrong costs money.
- **Zero-install, zero-storage**: works on a phone camera, forgets everything after; history lives in your browser.

## Impact & future scope

Immediate value for students, immigrants, seniors, and anyone facing bureaucratic paper. Next steps:

- ICS calendar export for deadlines; push reminders
- Multi-page PDF support + document history (opt-in)
- Organization lookup: real phone numbers/addresses for the sender
- "Practice the call" mode: role-play the phone call with AI before dialing
- Community knowledge: anonymized "others got this fee waived" insights

## Project structure

```
server.py            FastAPI backend, Featherless client, SSE streaming
prompts.py           Analysis/chat/draft prompts
static/              Single-page app (index.html, app.js, style.css)
static/samples/      Generated demo documents
scripts/gen_samples.py
AGENTS.md            Build notes & API quirks
```

## Disclaimer

Unfog helps you read documents. It is not legal, medical, or financial advice.
