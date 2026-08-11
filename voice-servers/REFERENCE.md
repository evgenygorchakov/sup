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

Замеры на RTX 4070. silero работает на процессоре: ~460 МБ RAM, быстрый старт, RTF 0.02–0.08,
около 0.5 с на фразу, кусок текста до ~800 символов.

Длинные ответы сервер режет по границам предложений (`SILERO_CHUNK_LIMIT`) и склеивает через
паузу 0.15 с; кусок, на котором модель споткнулась, пропускается с записью в журнал, а не
роняет запрос. `sup` синтезирует следующую фразу, пока играет текущая.

## Silero

Silero v5 (`v5_cis_base`), 48 кГц, 29 русских голосов, нейросетевая расстановка ударений,
лицензия MIT. GPU не нужен.

```sh
silero-say "Проверка связи."                      # голос по умолчанию
silero-say -s ru_ekaterina "Проверка связи."      # конкретный голос
silero-say -s irina "Проверка связи."             # старое имя из v3/v4 тоже примут
curl -s localhost:5011/voices                     # список голосов и псевдонимов
```

**Голоса** вшиты в модель, файлов на диске нет. Префикс `ru_` можно опускать, старые имена
из v3/v4 сервер переводит в v5 сам. На один сеанс голос выбирается переменной:
`USE_TTS=true TTS_VOICE=ru_ekaterina sup`.

| Голос | Псевдоним (v3/v4) | Что это |
|---|---|---|
| `ru_eduard` | `aidar` | мужской, глубокий — **по умолчанию** |
| `ru_alexandr` | `ruslan` | мужской баритон |
| `ru_ekaterina` | `kseniya` | женский, чистый |
| `ru_albina` | `natasha` | женский, тёплый |
| `ru_aigul` | `baya` | женский, мягкий |
| `ru_ramilia` | `irina` | женский, певучий |

Плюс ещё 23 (`ru_bogdan`, `ru_dmitriy`, `ru_vika`, `ru_igor`, `ru_karina`, `ru_zara` и другие),
полный список — `curl -s localhost:5011/voices`.

**Ударения.** Перед синтезом текст идёт через акцентор `silero_stress`: он ставит `+` перед
ударной гласной («Гот+ово», «зам+ок»), модель v5 эти метки понимает — отсюда правильные
омографы. Стоит ~0.08 с на фразу. Выключить насовсем — `Environment=SILERO_ACCENTOR=0`
в юните; разово — поле `"raw": true` в запросе:

```sh
curl -s localhost:5011/synthesize -H 'Content-Type: application/json' \
     -d '{"text":"Замок на двери.","raw":true}' -o /tmp/dry.wav && paplay /tmp/dry.wav
```

**Модель** приезжает не с Hugging Face: пакет `silero` читает `models.yml` из
[snakers4/silero-models](https://github.com/snakers4/silero-models) и кладёт `v5_cis_base.pt`
(~88 МБ) внутрь venv, в `site-packages/silero/model/`. Модель ударений идёт вместе с пакетом.

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
| silero-stress | 1.4 |
| torch (venv silero) | 2.13.0+cpu |
| Модель whisper | `small`, compute `int8`, устройство `cpu` |
| Модель Silero | `v5_cis_base`, 48 кГц, 29 русских голосов, по умолчанию `ru_eduard` |

```sh
~/.local/share/whisper/venv/bin/pip install 'faster-whisper==1.2.1' 'Flask==3.1.3'
~/.local/share/silero/venv/bin/pip install 'silero==0.5.5' 'silero-stress==1.4'
```
