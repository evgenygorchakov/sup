# voice-servers — локальные серверы речи для `sup`

Копии четырёх сервисов, которые живут **вне** репозитория — в `~/.local/` и в systemd. `sup`
общается с ними по HTTP и про их устройство ничего не знает. Папка нужна как резервная копия:
после переустановки системы всё поднимается отсюда. Редкие подробности — в [REFERENCE.md](REFERENCE.md).

## Что это

| Сервер | Порт | Что делает | Автозапуск |
|---|---|---|---|
| **whisper** | 5001 | распознаёт речь: `POST /transcribe`, тело — wav 16 кГц моно, ответ `{"text": …}`. Модель `small`, язык русский | да |
| **silero** | 5011 | синтез речи: `POST /synthesize`, тело `{"text": …}` + необязательное `voice`, ответ — wav. Silero v5, 29 русских голосов с ударениями, по умолчанию `ru_eduard` | да |
| **chatterbox** | 5012 | тот же контракт плюс поле `language`, но голос клонируется по короткому образцу. Только английский, нужна видеокарта | нет |
| **qwen-tts** | 5013 | тот же контракт, клонирование по образцу, здесь — русский клонированный голос. Нужна видеокарта | нет |

Контракт у всех трёх синтезаторов одинаковый, поэтому смена голоса — это только переменные
окружения, без правок в коде; `sup` находит серверы через `STT_HOST` и `TTS_HOST`. Все четыре
оформлены как systemd user-сервисы (`--user`, без `sudo`), оригиналы файлов лежат в
`~/.local/share/<сервис>/`, `~/.local/bin/` и `~/.config/systemd/user/`.

## Запустить

**Русский голос** (silero, Эдуард). Поднимать ничего не нужно, сервер на автозапуске:

```sh
USE_TTS=true sup
```

**Английский голос** (chatterbox, встроенный в модель — ровнее клонированного и без секунды
на кодирование образца):

```sh
systemctl --user start chatterbox
USE_TTS=true LANGUAGE=english TTS_HOST=http://127.0.0.1:5012 TTS_TIMEOUT_MS=120000 sup
```

**Свой голос, английский** (chatterbox, клонированный образец). `myvoice` — имя файла-образца
из `~/.local/share/chatterbox/voices` без расширения:

```sh
systemctl --user start chatterbox
USE_TTS=true LANGUAGE=english TTS_HOST=http://127.0.0.1:5012 \
    TTS_VOICE=myvoice TTS_TIMEOUT_MS=120000 sup
```

**Свой голос, русский** (qwen-tts, клонированный образец). Это то, чего не умеет chatterbox;
язык задан в самом юните, а голос берётся единственный из каталога, поэтому в команде остаётся
только адрес:

```sh
systemctl --user start qwen-tts
USE_TTS=true TTS_HOST=http://127.0.0.1:5013 TTS_TIMEOUT_MS=120000 sup
```

Почему в командах именно это:

- `TTS_TIMEOUT_MS` поднят: chatterbox и qwen-tts медленнее silero, а `sup` по умолчанию сдаётся через 30 с и выключает озвучку.
- `LANGUAGE=english` для chatterbox обязателен — модель настроена только на английский, по-русски звучит плохо; русский остаётся за silero и qwen-tts.
- Первый старт chatterbox — ~20 с и ~3.3 ГБ видеопамяти; отпустить обратно — `systemctl --user stop chatterbox`.

К любой из четырёх команд добавляются ещё две переменные, обе с полным путём, потому что `sup`
запускается из любого каталога:

- `PERSONA_FILE=~/dev/sup/persona.md` — markdown с описанием характера, который дописывается в конец системного промпта: голос становится ещё и манерой речи. Что персона делает с промптом, описано в `.env.example`; под отыгрыш стоит поднять `TEMPERATURE` до ~0.8, на дефолтных 0.2 он выходит плоским. Персона и озвучка независимы: `PERSONA_FILE` работает и без `USE_TTS`, а голос — без персоны.
- `TTS_LEXICON_FILE=~/dev/sup/lexicon.txt` — словарь произношения, строки вида `замок = зАмок`: тегов ударения qwen-tts не понимает, а заглавную букву слышит. Подмена доходит только до синтезатора, на экране остаётся обычное написание.

Внутри сессии `/tts` переключает озвучку, `/stt` — диктовку.

## Установка с нуля

Fedora 42 в WSL2 с включённым systemd. Все команды — от обычного пользователя, из этой папки:

```sh
cd ~/dev/sup/voice-servers
sudo dnf install -y pulseaudio-utils python3 ffmpeg-free
mkdir -p ~/.local/bin ~/.config/systemd/user
```

**whisper** (распознавание):

```sh
mkdir -p ~/.local/share/whisper
python3 -m venv ~/.local/share/whisper/venv
~/.local/share/whisper/venv/bin/pip install -U pip
~/.local/share/whisper/venv/bin/pip install -r whisper/requirements.txt
cp             whisper/server.py      ~/.local/share/whisper/server.py
install -m 755 whisper/whisper-serve  ~/.local/bin/whisper-serve
cp             whisper/whisper.service ~/.config/systemd/user/whisper.service
```

**silero** (основной голос):

```sh
mkdir -p ~/.local/share/silero
python3 -m venv ~/.local/share/silero/venv
~/.local/share/silero/venv/bin/pip install -U pip wheel
~/.local/share/silero/venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
~/.local/share/silero/venv/bin/pip install -r silero/requirements.txt
cp             silero/server.py     ~/.local/share/silero/server.py
install -m 755 silero/silero-serve  ~/.local/bin/silero-serve
install -m 755 silero/silero-say    ~/.local/bin/silero-say
cp             silero/silero.service ~/.config/systemd/user/silero.service
```

**chatterbox** (клонированный голос; нужна видеокарта, ~6.3 ГБ в venv):

```sh
mkdir -p ~/.local/share/chatterbox/voices
python3 -m venv ~/.local/share/chatterbox/venv
~/.local/share/chatterbox/venv/bin/pip install -U pip wheel
~/.local/share/chatterbox/venv/bin/pip install -r chatterbox/requirements.txt
cp             chatterbox/server.py         ~/.local/share/chatterbox/server.py
install -m 755 chatterbox/chatterbox-serve  ~/.local/bin/chatterbox-serve
install -m 755 chatterbox/chatterbox-say    ~/.local/bin/chatterbox-say
cp             chatterbox/chatterbox.service ~/.config/systemd/user/chatterbox.service
```

Встроенный голос у модели есть, так что этого уже достаточно. Клонированный добавляется
образцом — 7–20 секунд чистой речи одного человека, моно, 24 кГц:

```sh
ffmpeg -i запись.mp4 -ss 00:00:12 -t 14 \
       -af "aresample=24000:resampler=soxr:precision=28" \
       -ac 1 -c:a pcm_s16le ~/.local/share/chatterbox/voices/myvoice.wav
```

**qwen-tts** (клонированный голос на десяти языках; нужна видеокарта, ~5.5 ГБ в venv):

```sh
sudo dnf install -y python3.12 python3.12-devel
mkdir -p ~/.local/share/qwen-tts/voices
python3.12 -m venv ~/.local/share/qwen-tts/venv
~/.local/share/qwen-tts/venv/bin/pip install -U pip wheel
~/.local/share/qwen-tts/venv/bin/pip install -r qwen-tts/requirements.txt
cp             qwen-tts/server.py        ~/.local/share/qwen-tts/server.py
install -m 755 qwen-tts/qwen-tts-serve   ~/.local/bin/qwen-tts-serve
install -m 755 qwen-tts/qwen-tts-say     ~/.local/bin/qwen-tts-say
cp             qwen-tts/qwen-tts.service ~/.config/systemd/user/qwen-tts.service
```

Встроенных голосов у этой модели нет вообще, поэтому образец обязателен — тот же файл, что
для chatterbox, плюс дословная расшифровка рядом (её снимет соседний whisper):

```sh
ffmpeg -i запись.mp4 -ss 00:00:12 -t 14 \
       -af "aresample=24000:resampler=soxr:precision=28" \
       -ac 1 -c:a pcm_s16le ~/.local/share/qwen-tts/voices/myvoice.wav
curl -s localhost:5001/transcribe --data-binary @~/.local/share/qwen-tts/voices/myvoice.wav \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"].strip())' \
     > ~/.local/share/qwen-tts/voices/myvoice.txt
```

Голос в юните не задан, поэтому берётся единственный образец в каталоге; подробности про
образцы и расшифровки — в [REFERENCE.md](REFERENCE.md).

**Запуск и проверка:**

```sh
systemctl --user daemon-reload
systemctl --user enable --now whisper silero
curl -s localhost:5001/health; echo    # {"model":"small","language":"ru"}
curl -s localhost:5011/health; echo    # {"model":"v5_cis_base",…,"default_voice":"ru_eduard"}
```

Первый старт каждого сервера долгий — модели качаются сами.

## Грабли

- **`torch` для silero — отдельной командой из CPU-индекса**: колесо с PyPI тянет ненужный CUDA-стек на ~3 ГБ, а silero и на процессоре быстрее реального времени. У chatterbox наоборот, там `torch` с CUDA пинит сам `chatterbox-tts`.
- **`setuptools<81` в `chatterbox/requirements.txt` обязателен**: `resemble-perth` (водяной знак) импортирует выброшенный из setuptools 81 `pkg_resources`, отсюда крашлуп и `TypeError: 'NoneType' object is not callable` на `perth.PerthImplicitWatermarker()` в `journalctl --user -u chatterbox -e`.
- **`python3.12-devel` для qwen-tts нужен не для сборки колёс, а для первого синтеза**: Triton компилирует `cuda_utils.c` при первом обращении к видеокарте, иначе запрос падает с `fatal error: Python.h: No such file or directory` при живом сервере. Сам venv на 3.12, эту версию рекомендуют авторы.
- **flash-attn для qwen-tts не нужен**: сервер работает на `sdpa` и лишь предупреждает о его отсутствии; сборка идёт часами ради ускорения, включается через `QWEN_TTS_ATTENTION=flash_attention_2`.
- **Моделей в репозитории нет**, качаются при первом старте: whisper `small` ~450 МБ, silero ~88 МБ, chatterbox ~3.2 ГБ, qwen-tts ~4.3 ГБ. Первый `pip install` для chatterbox на медленном канале идёт часами.
- **`WorkingDirectory` у silero задан не для красоты**: пакет кэширует `latest_silero_models.yml` в рабочем каталоге процесса. Сама модель ложится внутрь venv, поэтому переустановка пакета = повторная закачка.
- **chatterbox и qwen-tts намеренно без автозапуска** — держат модель в видеопамяти (~3.3 и ~4.8 ГБ), а на той же карте обычно крутится LLM.
- **`Linger=no`**: сервисы живут, пока открыто хотя бы одно окно WSL; если нужно иначе — `loginctl enable-linger $USER`.
- **`requirements.txt` без пинов** — таблица заведомо рабочих версий и команды отката в [REFERENCE.md](REFERENCE.md).

Остальное — каталог голосов silero, свои образцы для chatterbox и qwen-tts, настройки серверов
переменными, диагностика звука в WSLg — тоже в [REFERENCE.md](REFERENCE.md).
