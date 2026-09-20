"""Unfog — backend. FastAPI + Featherless AI (OpenAI-compatible)."""
import base64
import io
import json
import os
import re
import time

import pymupdf
import requests
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from prompts import analyze_prompt, chat_system, draft_prompt, roleplay_system

BASE_URL = "https://api.featherless.ai/v1"
API_KEY = os.environ.get("FEATHERLESS_API_KEY", "")
# Cloudflare blocks default python-requests UA (error 1010) — always send ours.
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "User-Agent": "Unfog/1.0 (BunnieX hackathon demo)",
}

VISION_MODELS = ["Qwen/Qwen3-VL-30B-A3B-Instruct", "Qwen/Qwen2.5-VL-72B-Instruct"]
TEXT_MODELS = ["Qwen/Qwen2.5-72B-Instruct", "Qwen/Qwen3-32B",
               "mistralai/Mistral-Small-3.2-24B-Instruct-2506"]

LANGUAGES = {
    "en": "English", "zh": "Simplified Chinese", "ja": "Japanese", "ko": "Korean",
    "es": "Spanish", "fr": "French", "pt": "Portuguese", "hi": "Hindi",
    "ar": "Arabic", "ru": "Russian", "de": "German", "vi": "Vietnamese",
}

app = FastAPI(title="Unfog")
app.mount("/static", StaticFiles(directory="static"), name="static")


class LLMError(Exception):
    pass


def _post(payload: dict, timeout: int = 300, stream: bool = False):
    last = None
    for attempt in range(4):
        try:
            r = requests.post(f"{BASE_URL}/chat/completions", headers=HEADERS,
                              json=payload, timeout=timeout, stream=stream)
            if r.status_code == 200:
                return r
            last = f"{r.status_code}: {r.text[:200]}"
            # capacity / cold-start / rate-limit -> back off and retry
            if r.status_code in (429, 500, 502, 503) or "capacity" in r.text:
                time.sleep(2 * (attempt + 1))
                continue
            break
        except requests.RequestException as e:
            last = str(e)
            time.sleep(2 * (attempt + 1))
    raise LLMError(last or "unknown error")


def _strip_think(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    return re.sub(r"!{4,}", "", text).strip()


def _no_think(model, messages):
    """Qwen3 emits <think> filler without /no_think; append it to last user msg."""
    if "Qwen3" not in model or not messages:
        return messages
    msgs = list(messages)
    m = msgs[-1]
    if m.get("role") == "user" and isinstance(m.get("content"), str):
        msgs[-1] = {**m, "content": m["content"] + "\n/no_think"}
    return msgs


def complete(model_list, messages, max_tokens=1200, temperature=0.4):
    """Non-streaming completion with model fallback. Returns (text, model_used)."""
    last = None
    for model in model_list:
        try:
            r = _post({
                "model": model, "messages": _no_think(model, messages),
                "max_tokens": max_tokens, "temperature": temperature,
            })
            text = _strip_think(r.json()["choices"][0]["message"]["content"] or "")
            if not text:
                raise LLMError("empty output (upstream flood)")  # try next model
            return text, model
        except Exception as e:
            last = e
    raise LLMError(f"all models failed: {last}")


def _extract_json(text: str) -> dict:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise LLMError("no JSON in model output")
    return json.loads(text[start:end + 1])


def _prep_image(data: bytes) -> str:
    """Downscale + re-encode to JPEG data URL."""
    img = Image.open(io.BytesIO(data)).convert("RGB")
    img.thumbnail((1600, 1600))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def _to_images(filename: str, data: bytes, max_imgs: int = 3) -> list:
    """Turn an upload into <=max_imgs image data-URLs (handles PDF pages)."""
    if filename.lower().endswith(".pdf") or data[:5] == b"%PDF-":
        doc = pymupdf.open(stream=data, filetype="pdf")
        return [_prep_image(p.get_pixmap(dpi=140).tobytes("png"))
                for p in doc.pages()][:max_imgs]
    return [_prep_image(data)]


def _sse(obj) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _emit_point(buf: str) -> int:
    """Safe cut index: hold back trailing '!' runs and partial <think> tags."""
    s = len(buf.rstrip("!"))
    j = buf.rfind("<", 0, s)
    if j != -1 and ("<think>".startswith(buf[j:s]) or "</think>".startswith(buf[j:s])):
        s = j
    return s


def _stream(model_list, messages, max_tokens, temperature):
    """SSE generator with model fallback; filters upstream '!'-token floods."""
    err = None
    for model in model_list:
        try:
            r = _post({
                "model": model, "messages": _no_think(model, messages),
                "max_tokens": max_tokens, "temperature": temperature,
                "stream": True,
            }, stream=True)
            r.encoding = "utf-8"  # requests guesses ISO-8859-1 for text/event-stream
            buf, flooded, emitted = "", False, False
            for raw in r.iter_lines(decode_unicode=True):
                if not raw or not raw.startswith("data:"):
                    continue
                data = raw[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)["choices"][0].get("delta", {}).get("content") or ""
                except Exception:
                    continue
                buf += chunk
                cut = _emit_point(buf)
                out, buf = buf[:cut], buf[cut:]
                out = re.sub(r"!{4,}", "", re.sub(r"</?think>", "", out))
                if out:
                    emitted = True
                    yield _sse({"delta": out})
                if len(buf) >= 32 and set(buf) == {"!"}:
                    flooded = True
                    break
            tail = re.sub(r"!{4,}", "", re.sub(r"</?think>", "", buf))
            if tail and not flooded:
                yield _sse({"delta": tail})
            if flooded and not emitted:
                raise LLMError("pure '!' flood")  # whole response garbage -> next model
            yield _sse({"done": True, "model": model})
            return
        except Exception as e:
            err = e
    yield _sse({"error": str(err) or "model error"})


# ---------- routes ----------

@app.get("/")
def index():
    return FileResponse("static/index.html")


@app.get("/api/health")
def health():
    return {"ok": True, "has_key": bool(API_KEY)}


@app.post("/api/analyze")
async def analyze(files: list[UploadFile] = File(None), text: str = Form(""),
                  language: str = Form("en")):
    lang = LANGUAGES.get(language, "English")
    content = [{"type": "text", "text": analyze_prompt(lang)}]
    uploads = [f for f in (files or []) if f and f.filename]
    if uploads:
        imgs, truncated = [], False
        try:
            for f in uploads[:4]:
                data = await f.read()
                if len(data) > 15 * 1024 * 1024:
                    return JSONResponse({"error": f"{f.filename} too large (max 15MB)"}, 400)
                pages = _to_images(f.filename or "", data)
                for p in pages:
                    if len(imgs) >= 4:
                        truncated = True
                        break
                    imgs.append(p)
        except Exception:
            return JSONResponse({"error": "Could not read that file (images or PDF only)"}, 400)
        if not imgs:
            return JSONResponse({"error": "No readable pages found"}, 400)
        if len(uploads) > 1 or truncated:
            content.append({"type": "text",
                            "text": f"(This is a {len(imgs)}-page/multi-file document"
                                    + (", later pages were cut off" if truncated else "")
                                    + ". Treat all images as ONE document.)"})
        content += [{"type": "image_url", "image_url": {"url": u}} for u in imgs]
    elif text.strip():
        content.append({"type": "text",
                        "text": f"\n\nDOCUMENT TEXT:\n{text.strip()[:20000]}"})
    else:
        return JSONResponse({"error": "Provide an image, PDF, or some text"}, 400)

    last = None
    for _ in range(2):  # retry once: JSON parse can fail if output floods/truncates
        try:
            out, model = complete(VISION_MODELS, [{"role": "user", "content": content}],
                                  max_tokens=3000, temperature=0.2)
            result = _extract_json(out)
            result["_model"] = model
            return result
        except Exception as e:
            last = e
    return JSONResponse({"error": f"Analysis failed: {last}"}, 502)


class ChatReq(BaseModel):
    context: dict
    messages: list
    language: str = "en"
    mode: str = "qa"  # "qa" | "roleplay"


@app.post("/api/chat")
def chat(req: ChatReq):
    lang = LANGUAGES.get(req.language, "English")
    ctx = json.dumps(req.context, ensure_ascii=False)[:14000]
    sysp = roleplay_system(lang) if req.mode == "roleplay" else chat_system(lang)
    msgs = [{"role": "system", "content": sysp.format(context=ctx)}]
    for m in req.messages[-12:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": m["content"][:4000]})
    return StreamingResponse(_stream(TEXT_MODELS, msgs, 900, 0.5),
                             media_type="text/event-stream")


class DraftReq(BaseModel):
    context: dict
    kind: str = "reply_letter"
    language: str = "en"
    refine: str = ""      # e.g. "make it shorter and firmer"
    previous: str = ""    # previous draft text to revise


@app.post("/api/draft")
def draft(req: DraftReq):
    lang = LANGUAGES.get(req.language, "English")
    ctx = json.dumps(req.context, ensure_ascii=False)[:14000]
    msgs = [{"role": "user", "content": draft_prompt(req.kind, lang).format(context=ctx)}]
    if req.refine.strip() and req.previous.strip():
        msgs += [{"role": "assistant", "content": req.previous[:6000]},
                 {"role": "user", "content": f"Revise the draft: {req.refine.strip()[:500]}. Output only the revised draft, same language and format."}]
    return StreamingResponse(_stream(TEXT_MODELS, msgs, 2000, 0.5),
                             media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
