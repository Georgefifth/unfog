"""Unfog — backend. FastAPI + Featherless AI (OpenAI-compatible)."""
import base64
import io
import json
import os
import re
import time

import requests
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import BaseModel

from prompts import analyze_prompt, chat_system, draft_prompt

BASE_URL = "https://api.featherless.ai/v1"
API_KEY = os.environ.get("FEATHERLESS_API_KEY", "")
# Cloudflare blocks default python-requests UA (error 1010) — always send ours.
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "User-Agent": "Unfog/1.0 (BunnieX hackathon demo)",
}

VISION_MODELS = ["Qwen/Qwen3-VL-30B-A3B-Instruct", "Qwen/Qwen2.5-VL-72B-Instruct"]
TEXT_MODELS = ["Qwen/Qwen2.5-72B-Instruct", "Qwen/Qwen3-32B"]

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
                "chat_template_kwargs": {"enable_thinking": False},
            })
            text = r.json()["choices"][0]["message"]["content"] or ""
            return _strip_think(text), model
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
                "chat_template_kwargs": {"enable_thinking": False},
            }, stream=True)
            r.encoding = "utf-8"  # requests guesses ISO-8859-1 for text/event-stream
            buf, flooded = "", False
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
                    yield _sse({"delta": out})
                if len(buf) >= 32 and set(buf) == {"!"}:
                    flooded = True
                    break
            tail = re.sub(r"!{4,}", "", re.sub(r"</?think>", "", buf))
            if tail and not flooded:
                yield _sse({"delta": tail})
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
async def analyze(file: UploadFile = File(None), text: str = Form(""),
                  language: str = Form("en")):
    lang = LANGUAGES.get(language, "English")
    content = [{"type": "text", "text": analyze_prompt(lang)}]
    if file and file.filename:
        data = await file.read()
        if len(data) > 15 * 1024 * 1024:
            return JSONResponse({"error": "Image too large (max 15MB)"}, 400)
        try:
            content.append({"type": "image_url",
                            "image_url": {"url": _prep_image(data)}})
        except Exception:
            return JSONResponse({"error": "Could not read that image"}, 400)
    elif text.strip():
        content.append({"type": "text",
                        "text": f"\n\nDOCUMENT TEXT:\n{text.strip()[:20000]}"})
    else:
        return JSONResponse({"error": "Provide an image or some text"}, 400)

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


@app.post("/api/chat")
def chat(req: ChatReq):
    lang = LANGUAGES.get(req.language, "English")
    ctx = json.dumps(req.context, ensure_ascii=False)[:14000]
    msgs = [{"role": "system", "content": chat_system(lang).format(context=ctx)}]
    for m in req.messages[-12:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            msgs.append({"role": m["role"], "content": m["content"][:4000]})
    return StreamingResponse(_stream(TEXT_MODELS, msgs, 900, 0.5),
                             media_type="text/event-stream")


class DraftReq(BaseModel):
    context: dict
    kind: str = "reply_letter"
    language: str = "en"


@app.post("/api/draft")
def draft(req: DraftReq):
    lang = LANGUAGES.get(req.language, "English")
    ctx = json.dumps(req.context, ensure_ascii=False)[:14000]
    msgs = [{"role": "user", "content": draft_prompt(req.kind, lang).format(context=ctx)}]
    return StreamingResponse(_stream(TEXT_MODELS, msgs, 2000, 0.5),
                             media_type="text/event-stream")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
