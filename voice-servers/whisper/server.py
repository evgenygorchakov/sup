import io
import os

from faster_whisper import WhisperModel
from flask import Flask, jsonify, request

MODEL = os.environ.get("WHISPER_MODEL", "small")
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")

app = Flask(__name__)
model = WhisperModel(MODEL, device=DEVICE, compute_type=COMPUTE)


@app.post("/transcribe")
def transcribe():
    audio = request.get_data()
    if not audio:
        return jsonify(text="")

    segments, _ = model.transcribe(
        io.BytesIO(audio),
        language=LANGUAGE,
        vad_filter=True,
        condition_on_previous_text=False,
    )
    return jsonify(text=" ".join(segment.text.strip() for segment in segments).strip())


@app.get("/health")
def health():
    return jsonify(model=MODEL, language=LANGUAGE)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("WHISPER_PORT", "5001")))
