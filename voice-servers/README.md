# voice-servers — локальные серверы речи для `sup`

Копии двух сервисов, которые живут **вне** репозитория — в `~/.local/` и в systemd. `sup`
общается с ними по HTTP и про их устройство ничего не знает. Папка нужна как резервная копия:
после переустановки системы всё поднимается отсюда. Редкие подробности — в [REFERENCE.md](REFERENCE.md).

## Что это

| Сервер | Порт | Что делает | Автозапуск |
|---|---|---|---|
| **whisper** | 5001 | распознаёт речь: `POST /transcribe`, тело — wav 16 кГц моно, ответ `{"text": …}`. Модель `small`, язык русский | да |
| **silero** | 5011 | синтез речи: `POST /synthesize`, тело `{"text": …}` + необязательное `voice`, ответ — wav. Silero v5, 29 русских голосов с ударениями, по умолчанию `ru_eduard` | да |

Смена голоса — это только переменные окружения, без правок в коде; `sup` находит серверы
через `STT_HOST` и `TTS_HOST`. Оба оформлены как systemd user-сервисы (`--user`, без `sudo`),
оригиналы файлов лежат в `~/.local/share/<сервис>/`, `~/.local/bin/`
и `~/.config/systemd/user/`.

## Запустить

Поднимать ничего не нужно, оба сервера на автозапуске:

```sh
USE_TTS=true sup
```

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

**silero** (голос):

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

**Запуск и проверка:**

```sh
systemctl --user daemon-reload
systemctl --user enable --now whisper silero
curl -s localhost:5001/health; echo    # {"model":"small","language":"ru"}
curl -s localhost:5011/health; echo    # {"model":"v5_cis_base",…,"default_voice":"ru_eduard"}
```

Первый старт каждого сервера долгий — модели качаются сами.

## Грабли

- **`torch` для silero — отдельной командой из CPU-индекса**: колесо с PyPI тянет ненужный CUDA-стек на ~3 ГБ, а silero и на процессоре быстрее реального времени.
- **Моделей в репозитории нет**, качаются при первом старте: whisper `small` ~450 МБ, silero ~88 МБ.
- **`WorkingDirectory` у silero задан не для красоты**: пакет кэширует `latest_silero_models.yml` в рабочем каталоге процесса. Сама модель ложится внутрь venv, поэтому переустановка пакета = повторная закачка.
- **`Linger=no`**: сервисы живут, пока открыто хотя бы одно окно WSL; если нужно иначе — `loginctl enable-linger $USER`.
- **`requirements.txt` без пинов** — таблица заведомо рабочих версий и команды отката в [REFERENCE.md](REFERENCE.md).

Остальное — каталог голосов silero, настройки серверов переменными, диагностика звука
в WSLg — тоже в [REFERENCE.md](REFERENCE.md).
