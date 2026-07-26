import io
import os
import re
import time

import numpy as np
import soundfile as sf
import torch
from flask import Flask, Response, jsonify, request

MODEL = os.environ.get("QWEN_TTS_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
LANGUAGE = os.environ.get("QWEN_TTS_LANGUAGE", "Auto")
VOICES_DIR = os.path.expanduser(os.environ.get("QWEN_TTS_VOICES_DIR", "~/.local/share/qwen-tts/voices"))
DEFAULT_VOICE = os.environ.get("QWEN_TTS_VOICE", "")
DEVICE = os.environ.get("QWEN_TTS_DEVICE", "cuda:0")
ATTENTION = os.environ.get("QWEN_TTS_ATTENTION", "sdpa")
PORT = int(os.environ.get("QWEN_TTS_PORT", "5013"))
CHUNK_LIMIT = int(os.environ.get("QWEN_TTS_CHUNK_LIMIT", "300"))
TEMPERATURE = float(os.environ.get("QWEN_TTS_TEMPERATURE", "0.9"))
TOP_K = int(os.environ.get("QWEN_TTS_TOP_K", "50"))
TOP_P = float(os.environ.get("QWEN_TTS_TOP_P", "1.0"))
REPETITION_PENALTY = float(os.environ.get("QWEN_TTS_REPETITION_PENALTY", "1.05"))
MAX_NEW_TOKENS = int(os.environ.get("QWEN_TTS_MAX_NEW_TOKENS", "2048"))

REFERENCE_SUFFIXES = (".wav", ".mp3", ".flac", ".ogg", ".m4a")
SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")
SPEAKABLE = re.compile(r"\w", re.UNICODE)

ALIASES = {
    "auto": "Auto",
    "ru": "Russian",
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
}

if DEVICE.startswith("cuda") and not torch.cuda.is_available():
    print("[qwen-tts] cuda недоступна, откат на cpu", flush=True)
    DEVICE = "cpu"

print(f"[qwen-tts] загрузка модели на {DEVICE}…", flush=True)
started = time.monotonic()

from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained(
    MODEL,
    device_map=DEVICE,
    dtype=torch.bfloat16 if DEVICE.startswith("cuda") else torch.float32,
    attn_implementation=ATTENTION,
)

LANGUAGES = model.model.get_supported_languages() or []
SAMPLE_RATE = int(getattr(model.model.speech_tokenizer, "output_sample_rate", 24000))
PAUSE = np.zeros(int(SAMPLE_RATE * 0.15), dtype="float32")
prepared = None
prompt_items = None


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
print(f"[qwen-tts] готов за {time.monotonic() - started:.0f} с: voices={len(VOICES)}, "
      f"default={DEFAULT_VOICE or 'первый в каталоге'}, language={LANGUAGE}, "
      f"attention={ATTENTION}, {SAMPLE_RATE} Гц", flush=True)


def resolve_voice(name):
    known = catalog()
    if not name:
        only = next(iter(known)) if len(known) == 1 else None
        return only, known.get(only)
    name = os.path.basename(name.strip())
    return name, known.get(name)


def transcript(reference):
    path = f"{os.path.splitext(reference)[0]}.txt"
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return handle.read().strip() or None


def resolve_language(name):
    name = name.strip()
    canonical = ALIASES.get(name.lower(), name)
    for supported in LANGUAGES:
        if supported.lower() == canonical.lower():
            return supported
    return None


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


def prepare_voice(reference):
    global prepared, prompt_items
    reference_text = transcript(reference)
    wanted = (reference, os.path.getmtime(reference), reference_text)
    if wanted == prepared:
        return
    prompt_items = model.create_voice_clone_prompt(
        ref_audio=reference,
        ref_text=reference_text,
        x_vector_only_mode=reference_text is None,
    )
    prepared = wanted


def synthesize_chunk(text, language):
    wavs, rate = model.generate_voice_clone(
        text=text,
        language=language,
        voice_clone_prompt=prompt_items,
        max_new_tokens=MAX_NEW_TOKENS,
        do_sample=True,
        top_k=TOP_K,
        top_p=TOP_P,
        temperature=TEMPERATURE,
        repetition_penalty=REPETITION_PENALTY,
        subtalker_dosample=True,
        subtalker_top_k=TOP_K,
        subtalker_top_p=TOP_P,
        subtalker_temperature=TEMPERATURE,
    )
    return np.asarray(wavs[0], dtype="float32").ravel(), int(rate)


app = Flask(__name__)


@app.post("/synthesize")
def synthesize():
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return Response(status=204)

    requested = data.get("voice") or DEFAULT_VOICE
    name, reference = resolve_voice(requested)
    if reference is None:
        return jsonify(error=f"голос не найден: {name or 'не задан'}",
                       available=sorted(catalog()), directory=VOICES_DIR), 404

    chunks = split_text(text)
    if not chunks:
        return Response(status=204)

    language = resolve_language(data.get("language") or LANGUAGE)
    if language is None:
        return jsonify(error=f"язык не поддержан: {data.get('language') or LANGUAGE}",
                       available=sorted(LANGUAGES)), 400

    try:
        prepare_voice(reference)
    except Exception as failure:
        return jsonify(error=f"не удалось прочитать образец голоса: {failure}"), 500

    pieces = []
    rate = SAMPLE_RATE
    for chunk in chunks:
        try:
            piece, rate = synthesize_chunk(chunk, language)
            pieces.append(piece)
        except Exception as failure:
            print(f"[qwen-tts] пропущен фрагмент ({failure}): {chunk[:60]}", flush=True)
    if not pieces:
        return jsonify(error="синтез не удался"), 500

    pause = np.zeros(int(rate * 0.15), dtype="float32")
    audio = pieces[0]
    for piece in pieces[1:]:
        audio = np.concatenate((audio, pause, piece))

    buf = io.BytesIO()
    sf.write(buf, audio, rate, format="WAV", subtype="PCM_16")
    return Response(buf.getvalue(), mimetype="audio/wav")


@app.get("/voices")
def voices():
    known = catalog()
    return jsonify(voices={name: transcript(path) for name, path in known.items()},
                   default=DEFAULT_VOICE, directory=VOICES_DIR)


@app.get("/health")
def health():
    return jsonify(model=MODEL, language=LANGUAGE, languages=sorted(LANGUAGES),
                   voices=len(catalog()), default_voice=DEFAULT_VOICE, device=DEVICE,
                   attention=ATTENTION, sample_rate=SAMPLE_RATE, temperature=TEMPERATURE)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, threaded=False)
