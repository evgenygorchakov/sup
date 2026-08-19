# Справочник по voice-servers

Подробности, которые нужны редко. Как поставить и как запустить — в [README.md](README.md).

## Копии и оригиналы

Для каждого сервиса `<svc>` из `whisper`, `silero`:

| Копия здесь | Оригинал в системе |
|---|---|
| `<svc>/server.py` | `~/.local/share/<svc>/server.py` |
| `<svc>/<svc>-serve`, `<svc>/<svc>-say` | `~/.local/bin/` |
| `<svc>/<svc>.service` | `~/.config/systemd/user/` |

Скрипта `-say` нет только у whisper. Файлы `requirements.txt` — не копии, а просто списки
пакетов. Правишь рабочий файл в системе — скопируй его обратно сюда, иначе копия устареет.

## Синтез

Замеры на RTX 4070. silero работает на процессоре: ~540 МБ RAM, быстрый старт, RTF 0.02–0.03,
около 0.1 с на фразу, кусок текста до ~800 символов.

Длинные ответы сервер режет по границам предложений (`SILERO_CHUNK_LIMIT`) и склеивает через
паузу 0.15 с; кусок, на котором модель споткнулась, пропускается с записью в журнал, а не
роняет запрос. `sup` синтезирует следующую фразу, пока играет текущая.

## Silero

Silero `v5_5_ru`, 48 кГц, 5 русских голосов, встроенные ударения и омографы, вопросительная
интонация. Лицензия CC BY-NC 4.0 — только некоммерческое использование. GPU не нужен.

```sh
silero-say "Проверка связи."                      # голос и темп по умолчанию
silero-say -s kseniya "Проверка связи."           # конкретный голос
silero-say -r fast "Проверка связи."              # конкретный темп
curl -s localhost:5011/voices                     # списки голосов и темпов
```

**Голоса** вшиты в модель, файлов на диске нет. Имена — ровно те, что понимает модель,
без префиксов и псевдонимов; всё, чего нет в списке, сервер отвергает с 404. Голос и темп
задаются в `.env` (`TTS_VOICE`, `TTS_RATE`) или на один сеанс:
`USE_TTS=true TTS_VOICE=kseniya TTS_RATE=fast sup`.

| Голос | Что это |
|---|---|
| `aidar` | мужской — **по умолчанию** |
| `eugene` | мужской |
| `baya` | женский |
| `kseniya` | женский |
| `xenia` | женский |

**Темп** — поле `rate` в запросе, пять ступеней SSML-словаря модели: `x-slow` (×0.5),
`slow` (×0.8), `medium` (×1.0, **по умолчанию**), `fast` (×1.2), `x-fast` (×1.5). На `medium`
сервер синтезирует обычным текстом, на остальных заворачивает фразу в
`<speak><prosody rate="…">`. Дефолт сервера меняется через `Environment=SILERO_RATE=` в юните.

Побочный эффект SSML-ветки: модель зовёт `convert_to_orig` без охраны, а `ext_alph` у русского
пакета — `None`, поэтому любая латиница в тексте роняла бы синтез. `server.py` подставляет
пустой словарь сразу после загрузки модели.

**Ударения** считает сама модель: `apply_tts` вызывается с `put_accent`, `put_stress_homo`,
`put_yo`, `put_yo_homo` — отсюда правильные омографы («з+амок» против «зам+ок») и «ё».
Отдельного акцентора больше нет. Ручные метки `+` перед ударной гласной модель тоже понимает
и не перебивает. Выключить автоударения насовсем — `Environment=SILERO_ACCENTOR=0` в юните;
разово — поле `"raw": true` в запросе:

```sh
curl -s localhost:5011/synthesize -H 'Content-Type: application/json' \
     -d '{"text":"Замок на двери.","raw":true}' -o /tmp/dry.wav && paplay /tmp/dry.wav
```

**Модель** приезжает не с Hugging Face: пакет `silero` читает `models.yml` из
[snakers4/silero-models](https://github.com/snakers4/silero-models) и кладёт `v5_5_ru.pt`
(~139 МБ) внутрь venv, в `site-packages/silero/model/`.

**Почему не `v5_cis_base`.** Соседняя ветка v5 на 29 русских голосов и 20 языков СНГ, под MIT,
но без встроенных ударений — им нужен отдельный пакет `silero_stress`. Стояла здесь раньше;
29 голосов оказались не нужны. Вернуться — `Environment=SILERO_MODEL=v5_cis_base`,
`SILERO_VOICE=ru_eduard`, плюс `pip install silero-stress` и правка `synthesize_chunk`.

**Настройки** — переменными `SILERO_*` в `[Service]` юнита, полный список с дефолтами в начале
`silero/server.py`. Голос в юните не задан, работает дефолт сервера. После правки —
`daemon-reload` + `restart silero`.

## Управление серверами

Всё с флагом `--user`, без `sudo`. Вместо `whisper silero` подставляется любой из двух.

```sh
systemctl --user status    whisper silero    # подробно
systemctl --user is-active whisper silero    # коротко
systemctl --user start     whisper silero
systemctl --user restart   whisper silero    # например после правки юнита
systemctl --user stop      whisper silero
systemctl --user enable    whisper silero    # автозапуск
systemctl --user disable   whisper silero

journalctl --user -u silero -e               # логи: -e в конец, -f следить

~/.local/bin/silero-serve                    # foreground мимо systemd, для отладки;
                                             # сначала останови сервис
```

Оба поднимаются сами, как только стартует пользовательская сессия WSL, то есть когда
открываешь терминал.

## Смена языка распознавания

Язык whisper задаётся `WHISPER_LANGUAGE` (по умолчанию `ru` из `server.py`): строка
`Environment=WHISPER_LANGUAGE=en` в секции `[Service]` юнита, затем `daemon-reload`,
`restart whisper` и проверка `curl -s localhost:5001/health`.

Автоопределение одной переменной не включается — faster-whisper ждёт для этого `None`,
а пустая строка не годится. Нужна правка `server.py`:

```python
LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru")   # было
LANGUAGE = os.environ.get("WHISPER_LANGUAGE") or None  # стало
```

После этого язык определяется по каждой фразе (чередовать между фразами можно, смешивать
внутри одной — нет). Модель `small` хорошо распознаёт английский и средне русский; для
лучшего русского — `Environment=WHISPER_MODEL=medium`. Остальные переменные в начале
`whisper/server.py`: `WHISPER_MODEL`, `WHISPER_DEVICE`, `WHISPER_COMPUTE`, `WHISPER_PORT`.

## Диагностика звука (WSLg)

Звук в WSL2 идёт через WSLg, PulseAudio-совместимый слой; обычно настраивать нечего.

```sh
pactl info                        # сервер PulseAudio должен отвечать
pactl list short sinks            # вывод (обычно RDPSink)
pactl list short sources          # ввод: микрофон — RDPSource
paplay /usr/share/sounds/alsa/Front_Center.wav
parecord --channels=1 --rate=16000 /tmp/test.wav   # Ctrl+C через пару секунд
paplay /tmp/test.wav
```

Конкретный микрофон выбирается переменной `STT_DEVICE` (имя из `pactl list short sources`,
пусто = устройство по умолчанию). Трюк для тестов без микрофона: источник `RDPSink.monitor`
слышит то, что играет система, — можно озвучить фразу через silero и распознать её же
через whisper.

## Версии для отката

`requirements.txt` ставят свежие версии без пинов. Ниже — то, что стояло на момент снятия
копии и заведомо работало.

| Компонент | Рабочая версия |
|---|---|
| Python (whisper, silero) | 3.13 |
| faster-whisper | 1.2.1 |
| Flask | 3.1.3 |
| silero | 0.5.5 |
| torch (venv silero) | 2.13.0+cpu |
| Модель whisper | `small`, compute `int8`, устройство `cpu` |
| Модель Silero | `v5_5_ru`, 48 кГц, 5 русских голосов, по умолчанию `aidar` |

```sh
~/.local/share/whisper/venv/bin/pip install 'faster-whisper==1.2.1' 'Flask==3.1.3'
~/.local/share/silero/venv/bin/pip install 'silero==0.5.5'
```
