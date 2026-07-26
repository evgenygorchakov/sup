# Справочник по voice-servers

Подробности, которые нужны редко. Как поставить и как запустить — в [README.md](README.md).

## Копии и оригиналы

Для каждого сервиса `<svc>` из `whisper`, `silero`, `chatterbox`, `qwen-tts`:

| Копия здесь | Оригинал в системе |
|---|---|
| `<svc>/server.py` | `~/.local/share/<svc>/server.py` |
| `<svc>/<svc>-serve`, `<svc>/<svc>-say` | `~/.local/bin/` |
| `<svc>/<svc>.service` | `~/.config/systemd/user/` |

Скрипта `-say` нет только у whisper. Файлы `requirements.txt` — не копии, а просто списки
пакетов. Правишь рабочий файл в системе — скопируй его обратно сюда, иначе копия устареет.

## Сравнение синтезаторов

Замеры на RTX 4070, у qwen-tts — на `sdpa`, без flash-attn.

| | silero | chatterbox | qwen-tts |
|---|---|---|---|
| Железо | CPU, ~460 МБ RAM | CUDA, ~3.3 ГБ VRAM | CUDA, ~4.8 ГБ VRAM |
| Старт сервера | быстрый | ~10 с | ~9 с |
| Синтез | RTF 0.02–0.08, ~0.5 с на фразу | ~2.7 с на 4.5 с звука | ~5 с на 3.8 с звука |
| Первый запрос | — | +~9 с (прогрев CUDA) | +~2 с (CUDA и Triton) |
| Новый образец | голоса вшиты | +~1 с на кодирование | +~1 с на кодирование |
| Кусок текста | ~800 символов | ~300 символов | ~300 символов |

Длинные ответы все три режут по границам предложений (`*_CHUNK_LIMIT`) и склеивают через
паузу 0.15 с; кусок, на котором модель споткнулась, пропускается с записью в журнал, а не
роняет запрос. У авторегрессивных chatterbox и qwen-tts лимит куска меньше — на длинном
куске они сбиваются. qwen-tts медленнее реального времени в ~1.3 раза, но `sup` синтезирует
следующую фразу, пока играет текущая, поэтому отставание копится только на длинных ответах.

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

## Chatterbox

[Chatterbox Multilingual](https://huggingface.co/ResembleAI/chatterbox) от Resemble AI —
0.5 млрд параметров, повторяет любой голос по короткому образцу без дообучения, лицензия MIT.
Умеет 23 языка, здесь настроен на английский (`CHATTERBOX_LANGUAGE=en` в юните): по-русски
модель звучит плохо. В каждый файл вшивается неслышимый водяной знак Perth — так задумано
авторами, отключать не стоит.

```sh
chatterbox-say "Radio check."                      # встроенный голос модели
chatterbox-say -s myvoice "Radio check."           # образец myvoice.wav
chatterbox-say -s myvoice -l de "Funkprobe."       # другой язык на один запрос
curl -s localhost:5012/voices                      # что лежит в каталоге образцов
```

Текст английский не случайно: сервер настроен на `en` и русскую фразу прочтёт по английским
правилам. Русское — через `silero-say`.

**Как добавить голос.** Голос — это файл-образец в `~/.local/share/chatterbox/voices/`, имя
файла без расширения и есть имя голоса (`myvoice.wav` → `TTS_VOICE=myvoice`); форматы `wav`,
`mp3`, `flac`, `ogg`, `m4a`. Каталог перечитывается на каждый запрос, перезапускать сервер не
нужно; образец кодируется один раз и держится в памяти, а подменённый файл сервер замечает
по времени изменения. Образец: 7–20 секунд чистой речи одного человека, без музыки, шума и
эха, моно, лучше от 24 кГц, на языке синтеза — иначе приедет акцент языка образца (помогает
`"cfg": 0` в запросе).

```sh
ffmpeg -i запись.mp4 -ss 00:00:12 -t 14 -ac 1 -ar 24000 \
       ~/.local/share/chatterbox/voices/myvoice.wav
curl -s localhost:5012/voices          # проверить, что сервер его видит
```

Записи стоит брать свои: чужой голос — это чужой голос, а у роликов, игр и фильмов вдобавок
есть правообладатель. Если у исходника пик выше нуля и частота не 24 кГц, вместо простого
`-ar` лучше сбросить уровень и отдать ресемпл soxr:
`-af "volume=-1.7dB,aresample=24000:resampler=soxr:precision=28"`. Образец короче семи секунд
или с эффектом на голосе тоже клонируется, но заметно менее стабильно.

**Файлы модели** качаются с Hugging Face в `~/.local/share/chatterbox/models` (`HF_HOME`
в `chatterbox-serve` и в юните): `t3_mtl23ls_v2.safetensors` 2144 МБ — языковая модель,
`s3gen.pt` 1057 МБ — вокодер, `ve.pt` 5.7 МБ — кодировщик голоса, плюс ~2 МБ таблиц графем
и дефолтного голоса.

**Настройки** — переменными `CHATTERBOX_*` в `[Service]` юнита, полный список с дефолтами
в начале `chatterbox/server.py`. Юнит расходится с сервером в одном: `CHATTERBOX_LANGUAGE=en`
против дефолтного `ru`. На один запрос переопределяются поля `voice`, `language`,
`exaggeration` и `cfg` в теле `/synthesize`:

```sh
curl -s localhost:5012/synthesize -H 'Content-Type: application/json' \
     -d '{"text":"Radio check.","voice":"myvoice","exaggeration":0.7}' \
     -o /tmp/test.wav && paplay /tmp/test.wav
```

Со стороны `sup` язык запроса переопределяется переменной `TTS_LANGUAGE` (пусто = как
настроен сервер; silero это поле игнорирует).

## Qwen3-TTS

[Qwen3-TTS-12Hz-1.7B-Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) — 1.7 млрд
параметров, клонирование по образцу от трёх секунд, лицензия Apache 2.0, десять языков
(русский, английский, китайский, японский, корейский, немецкий, французский, португальский,
испанский, итальянский). Встроенных голосов нет ни одного, зато один образец читает на любом
из десяти языков.

Готовые голоса есть у соседних вариантов, но не годятся: у `1.7B-CustomVoice` девять пресетов
без русского, `1.7B-VoiceDesign` собирает голос по текстовому описанию; обе умеют `instruct`
(«скажи сердито»), которого у `Base` нет. Переключается переменной `QWEN_TTS_MODEL`, но вызовы
в `server.py` придётся править — у них другие методы генерации.

```sh
qwen-tts-say "Проверка связи."                     # голос, если он в каталоге один
qwen-tts-say -s myvoice "Проверка связи."          # образец myvoice.wav
qwen-tts-say -s myvoice -l english "Radio check."  # язык на один запрос
curl -s localhost:5013/voices                      # образцы и их расшифровки
```

Язык указывать не обязательно: в юните стоит `russian`, а дефолт `server.py` — `Auto`, режим
модели, где язык определяется по тексту. Сервер понимает и полные имена (`russian`), и коды
(`ru`) — те же, что у chatterbox, чтобы `TTS_LANGUAGE` не менять при переключении серверов.

**Как добавить голос.** Голос — пара файлов в `~/.local/share/qwen-tts/voices/`: образец
`имя.wav` и рядом `имя.txt` с дословной расшифровкой. Расшифровка включает режим ICL — модель
видит и звук, и текст, и голос выходит ближе к оригиналу; без `.txt` сервер молча падает
в `x_vector_only`: чуть быстрее и чуть менее похоже. Образец: 5–20 секунд чистой речи одного
человека, моно; язык образца на язык синтеза не влияет. Ресемплинг сервер делает сам, но
проще сразу привести файл к 24 кГц моно, чтобы whisper не работал по чужой частоте:

```sh
ffmpeg -i запись.mp4 -ss 00:00:12 -t 14 -ac 1 -ar 24000 \
       ~/.local/share/qwen-tts/voices/myvoice.wav
curl -s localhost:5001/transcribe --data-binary @~/.local/share/qwen-tts/voices/myvoice.wav \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"].strip())' \
     > ~/.local/share/qwen-tts/voices/myvoice.txt
curl -s localhost:5013/voices          # сервер должен видеть и файл, и расшифровку
```

Расшифровку снимает соседний whisper, но он настроен на русский: английский образец он
перепишет русскими словами, и текст придётся набрать руками. Имена собственные стоит
проверить глазами — whisper пишет их через дефис или с ошибкой чаще, чем остальной текст.
Записи, как и у chatterbox, стоит брать свои: у роликов, игр и фильмов есть правообладатель.

Кросс-язычность у модели односторонняя по качеству: русский образец читает по-английски
с отчётливым акцентом — тембр переносится, фонетика нет, и ICL это усиливает, подкладывая
ещё и русский ref-текст. Поэтому английское остаётся за chatterbox, а `QWEN_TTS_LANGUAGE`
в юните прибит к русскому.

**Ударения.** Своего акцентора, как у silero, здесь нет — модель выводит ударение сама и на
редких именах мимо. Единственная разметка, на которую она отзывается, — заглавная буква:
«зАмок» звучит с ударением на первом слоге, «замок» — на втором (акут, удвоение гласной
и дефис проверены, не дали ничего). Постоянные поправки удобно держать в словаре произношения
`sup`: путь в `TTS_LEXICON_FILE`, строки вида `замок = зАмок`, звёздочка в конце левой части
правит основу и сохраняет окончание (`Тьюринг* = ТьЮринг` чинит и «Тьюринга», и «Тьюрингу»).
Подмена доходит только до синтезатора, на экране остаётся обычное написание.

**Файлы модели** качаются с Hugging Face в `~/.local/share/qwen-tts/models` (`HF_HOME`
в `qwen-tts-serve` и в юните): `model.safetensors` 3.86 ГБ — языковая модель, папка
`speech_tokenizer` ~450 МБ — кодек, который делает из токенов звук и снимает отпечаток
с образца.

**Настройки** — переменными `QWEN_TTS_*` в `[Service]` юнита, полный список с дефолтами
и параметрами сэмплирования в начале `qwen-tts/server.py`. Юнит расходится с сервером в одном:
`QWEN_TTS_LANGUAGE=russian` против дефолтного `Auto`. Голос в юните не задан — сервер берёт
единственный образец из каталога, а `QWEN_TTS_VOICE=<имя>` нужен, когда их там несколько.
На один запрос переопределяются поля `voice` и `language` в теле `/synthesize`:

```sh
curl -s localhost:5013/synthesize -H 'Content-Type: application/json' \
     -d '{"text":"Проверка связи.","voice":"myvoice"}' \
     -o /tmp/test.wav && paplay /tmp/test.wav
```

## Управление серверами

Всё с флагом `--user`, без `sudo`. Вместо `whisper silero` подставляется любой из четырёх.

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

whisper и silero поднимаются сами, как только стартует пользовательская сессия WSL, то есть
когда открываешь терминал. chatterbox и qwen-tts — только руками.

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
| Python (whisper, silero, chatterbox) | 3.13 |
| Python (qwen-tts) | 3.12 |
| faster-whisper | 1.2.1 |
| Flask | 3.1.3 |
| silero | 0.5.5 |
| silero-stress | 1.4 |
| torch (venv silero) | 2.13.0+cpu |
| chatterbox-tts | 0.1.7 |
| torch (venv chatterbox) | 2.6.0 (пин самого `chatterbox-tts`, колесо с CUDA) |
| setuptools (venv chatterbox) | 80.10.2 — **не выше 80** |
| qwen-tts | 0.1.1 |
| transformers (venv qwen-tts) | 4.57.3 — пин самого `qwen-tts` |
| torch (venv qwen-tts) | 2.13.0 (колесо с CUDA 13) |
| Модель whisper | `small`, compute `int8`, устройство `cpu` |
| Модель Silero | `v5_cis_base`, 48 кГц, 29 русских голосов, по умолчанию `ru_eduard` |
| Модель Chatterbox | Multilingual `t3_mtl23ls_v2`, 24 кГц, голоса из своих образцов |
| Модель Qwen3-TTS | `Qwen3-TTS-12Hz-1.7B-Base`, 24 кГц, голоса из своих образцов |

```sh
~/.local/share/whisper/venv/bin/pip install 'faster-whisper==1.2.1' 'Flask==3.1.3'
~/.local/share/silero/venv/bin/pip install 'silero==0.5.5' 'silero-stress==1.4'
~/.local/share/chatterbox/venv/bin/pip install 'chatterbox-tts==0.1.7' 'setuptools==80.10.2'
~/.local/share/qwen-tts/venv/bin/pip install 'qwen-tts==0.1.1'
```
