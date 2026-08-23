# optional

PDF conversion and voice need something installed outside this repository, so both are **off by
default** and `sup` works without them. Everything here is optional: skip the folder and nothing
breaks.

| Feature | What it needs | Turn on | Setup |
|---|---|---|---|
| PDF → markdown | the [marker](https://github.com/datalab-to/marker) converter in its own venv | `USE_PDF_CONVERT=true`, or `/pdf on` mid-session | [`pdf/README.md`](pdf/README.md) |
| Dictation (speech to text) | a local [faster-whisper](https://github.com/SYSTRAN/faster-whisper) server | `USE_STT=true`, or `/stt` mid-session | [`voice/README.md`](voice/README.md) |
| Speaking answers (text to speech) | a local [Silero](https://github.com/snakers4/silero-models) server | `USE_TTS=true`, or `/tts` mid-session | [`voice/README.md`](voice/README.md) |

- The setup guides are in Russian and written for Fedora 42 in WSL2; the steps are plain `venv`,
  `install`, and systemd, so another distribution differs only in the package names.
- Nothing here runs as part of `sup` — the app talks to `pdf-to-md` over a subprocess and to the
  speech servers over HTTP, so all of it stays on the machine and can be replaced with anything
  that speaks the same interface (`STT_HOST`, `TTS_HOST`, `PDF_CONVERTER`).
- Turning a feature on without its half installed is not fatal: a dropped PDF stays a plain path
  and `sup` says so once, a TTS server that does not answer turns speech off by itself, and a
  missing STT server just reports the failed connection when you release `Ctrl+G`.
