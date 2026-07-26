import io
import os
import re
import time

import numpy as np
import soundfile as sf
import torch
from flask import Flask, Response, jsonify, request

LANGUAGE = os.environ.get("CHATTERBOX_LANGUAGE", "ru")
VOICES_DIR = os.path.expanduser(os.environ.get("CHATTERBOX_VOICES_DIR", "~/.local/share/chatterbox/voices"))
DEFAULT_VOICE = os.environ.get("CHATTERBOX_VOICE", "")
DEVICE = os.environ.get("CHATTERBOX_DEVICE", "cuda")
PORT = int(os.environ.get("CHATTERBOX_PORT", "5012"))
CHUNK_LIMIT = int(os.environ.get("CHATTERBOX_CHUNK_LIMIT", "300"))
EXAGGERATION = float(os.environ.get("CHATTERBOX_EXAGGERATION", "0.5"))
CFG_WEIGHT = float(os.environ.get("CHATTERBOX_CFG", "0.5"))
TEMPERATURE = float(os.environ.get("CHATTERBOX_TEMPERATURE", "0.8"))

REFERENCE_SUFFIXES = (".wav", ".mp3", ".flac", ".ogg", ".m4a")
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
SPEAKABLE = re.compile(r"\w", re.UNICODE)

if DEVICE.startswith("cuda") and not torch.cuda.is_available():
    print("[chatterbox] cuda недоступна, откат на cpu", flush=True)
    DEVICE = "cpu"

print(f"[chatterbox] загрузка модели на {DEVICE}…", flush=True)
started = time.monotonic()

from chatterbox.mtl_tts import SUPPORTED_LANGUAGES, ChatterboxMultilingualTTS

MODEL = "multilingual t3_mtl23ls_v2"

model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
SAMPLE_RATE = int(model.sr)
PAUSE = np.zeros(int(SAMPLE_RATE * 0.15), dtype="float32")
BUILTIN_CONDS = model.conds
prepared = None


def catalog():
    if not os.path.isdir(VOICES_DIR):
        return {}
    found = {}
    for entry in sorted(os.listdir(VOICES_DIR)):
        stem, suffix = os.path.splitext(entry)
        if suffix.lower() in REFERENCE_SUFFIXES:
            found[stem] = os.path.join(VOICES_DIR, entry)
    return found


VOICES = catalog()
print(f"[chatterbox] готов за {time.monotonic() - started:.0f} с: voices={len(VOICES)}, "
      f"default={DEFAULT_VOICE or 'встроенный'}, language={LANGUAGE}, {SAMPLE_RATE} Гц", flush=True)


def resolve_voice(name):
    if not name:
        return None, None
    name = os.path.basename(name.strip())
    known = catalog()
    if name in known:
        return name, known[name]
    return name, None


def split_text(text):
    chunks = []
    current = ""
    for sentence in SENTENCE_END.split(text):
        if not sentence:
            continue
        if len(current) + len(sentence) + 1 <= CHUNK_LIMIT:
            current = f"{current} {sentence}".strip()
            continue
        if current:
            chunks.append(current)
        while len(sentence) > CHUNK_LIMIT:
            cut = sentence.rfind(" ", 0, CHUNK_LIMIT)
            cut = cut if cut > 0 else CHUNK_LIMIT
            chunks.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        current = sentence
    if current:
        chunks.append(current)
    return [chunk for chunk in chunks if SPEAKABLE.search(chunk)]


def prepare_voice(reference, exaggeration):
    global prepared
    wanted = (reference, os.path.getmtime(reference), exaggeration) if reference else None
    if wanted == prepared:
        return
    if reference:
        model.prepare_conditionals(reference, exaggeration=exaggeration)
    else:
        model.conds = BUILTIN_CONDS
    prepared = wanted


def synthesize_chunk(text, language, exaggeration, cfg_weight):
    audio = model.generate(
        text,
        language_id=language,
        exaggeration=exaggeration,
        cfg_weight=cfg_weight,
        temperature=TEMPERATURE,
    )
    if hasattr(audio, "cpu"):
        audio = audio.cpu().numpy()
    return np.asarray(audio, dtype="float32").ravel()


app = Flask(__name__)


@app.post("/synthesize")
def synthesize():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return Response(status=204)

    requested = data.get("voice") or DEFAULT_VOICE
    name, reference = resolve_voice(requested)
    if name and reference is None:
        return jsonify(error=f"голос не найден: {name}", available=sorted(catalog())), 404

    chunks = split_text(text)
    if not chunks:
        return Response(status=204)

    language = data.get("language") or LANGUAGE
    if language not in SUPPORTED_LANGUAGES:
        return jsonify(error=f"язык не поддержан: {language}", available=sorted(SUPPORTED_LANGUAGES)), 400
    exaggeration = float(data.get("exaggeration", EXAGGERATION))
    cfg_weight = float(data.get("cfg", CFG_WEIGHT))

    try:
        prepare_voice(reference, exaggeration)
    except Exception as failure:
        return jsonify(error=f"не удалось прочитать образец голоса: {failure}"), 500

    pieces = []
    for chunk in chunks:
        try:
            pieces.append(synthesize_chunk(chunk, language, exaggeration, cfg_weight))
        except Exception as failure:
            print(f"[chatterbox] пропущен фрагмент ({failure}): {chunk[:60]}", flush=True)
    if not pieces:
        return jsonify(error="синтез не удался"), 500

    audio = pieces[0]
    for piece in pieces[1:]:
        audio = np.concatenate((audio, PAUSE, piece))

    buf = io.BytesIO()
    sf.write(buf, audio, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), mimetype="audio/wav")


@app.get("/voices")
def voices():
    known = catalog()
    return jsonify(voices=sorted(known), default=DEFAULT_VOICE, directory=VOICES_DIR)


@app.get("/health")
def health():
    return jsonify(model=MODEL, language=LANGUAGE, languages=len(SUPPORTED_LANGUAGES),
                   voices=len(catalog()), default_voice=DEFAULT_VOICE, device=DEVICE,
                   sample_rate=SAMPLE_RATE, exaggeration=EXAGGERATION, cfg=CFG_WEIGHT)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=False)
