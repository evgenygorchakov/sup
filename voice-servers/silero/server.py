import io
import os
import re

import numpy as np
import soundfile as sf
import silero
from flask import Flask, Response, jsonify, request

MODEL = os.environ.get("SILERO_MODEL", "v5_cis_base")
LANGUAGE = os.environ.get("SILERO_LANGUAGE", "ru")
DEFAULT_VOICE = os.environ.get("SILERO_VOICE", "ru_eduard")
DEVICE = os.environ.get("SILERO_DEVICE", "cpu")
SAMPLE_RATE = int(os.environ.get("SILERO_SAMPLE_RATE", "48000"))
PORT = int(os.environ.get("SILERO_PORT", "5011"))
CHUNK_LIMIT = int(os.environ.get("SILERO_CHUNK_LIMIT", "800"))
USE_ACCENTOR = os.environ.get("SILERO_ACCENTOR", "1").lower() not in ("0", "false", "no")

ALIASES = {
    "aidar": "ru_eduard",
    "baya": "ru_aigul",
    "kseniya": "ru_ekaterina",
    "natasha": "ru_albina",
    "ruslan": "ru_alexandr",
    "irina": "ru_ramilia",
    "xenia": "ru_kejilgan",
}

SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
SPEAKABLE = re.compile(r"\w", re.UNICODE)
PAUSE = np.zeros(int(SAMPLE_RATE * 0.15), dtype="float32")

print(f"[silero] загрузка {MODEL} на {DEVICE}…", flush=True)
model, _ = silero.silero_tts(language=LANGUAGE, speaker=MODEL, sample_rate=SAMPLE_RATE)
model.to(DEVICE)

VOICES = sorted(name for name in getattr(model, "speakers", []) if name.startswith(f"{LANGUAGE}_"))

accentor = None
if USE_ACCENTOR:
    from silero_stress import accentor as stress

    accentor = stress.load_accentor(LANGUAGE)

print(f"[silero] готов: voices={len(VOICES)}, default={DEFAULT_VOICE}, language={LANGUAGE}, "
      f"accentor={'on' if accentor else 'off'}, {SAMPLE_RATE} Гц", flush=True)


def resolve_voice(name):
    name = os.path.basename(name.strip())
    name = ALIASES.get(name, name)
    if name in VOICES:
        return name
    prefixed = f"{LANGUAGE}_{name}"
    return prefixed if prefixed in VOICES else None


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


def synthesize_chunk(text, voice, stressed):
    if stressed and accentor is not None:
        text = accentor(text)
    audio = model.apply_tts(text=text, speaker=voice, sample_rate=SAMPLE_RATE)
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
    voice = resolve_voice(requested)
    if voice is None:
        return jsonify(error=f"голос не найден: {requested}", available=VOICES), 404

    chunks = split_text(text)
    if not chunks:
        return Response(status=204)

    stressed = data.get("raw") is not True
    pieces = []
    for chunk in chunks:
        try:
            pieces.append(synthesize_chunk(chunk, voice, stressed))
        except Exception as failure:
            print(f"[silero] пропущен фрагмент ({failure}): {chunk[:60]}", flush=True)
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
    return jsonify(voices=VOICES, default=DEFAULT_VOICE, aliases=ALIASES)


@app.get("/health")
def health():
    return jsonify(model=MODEL, language=LANGUAGE, voices=len(VOICES), default_voice=DEFAULT_VOICE,
                   device=DEVICE, sample_rate=SAMPLE_RATE, accentor=accentor is not None)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=False)
