# optional/pdf — установка конвертера PDF → markdown

Fedora 42 в WSL2. Все команды подряд, от обычного пользователя.

```sh
mkdir -p ~/.local/bin ~/.local/share/marker
python3 -m venv ~/.local/share/marker/venv
~/.local/share/marker/venv/bin/pip install -U pip wheel

# torch — отдельно и до marker, иначе pip притянет CUDA-стек на несколько гигабайт
~/.local/share/marker/venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
~/.local/share/marker/venv/bin/pip install -r ~/dev/my-sup/optional/pdf/requirements.txt

cp             ~/dev/my-sup/optional/pdf/convert.py ~/.local/share/marker/convert.py
install -m 755 ~/dev/my-sup/optional/pdf/pdf-to-md  ~/.local/bin/pdf-to-md

# модели surya (~3.4 ГБ) — через curl -C -, можно прерывать и запускать снова
~/dev/my-sup/optional/pdf/fetch-models
```

Проверка:

```sh
pdf-to-md ~/Downloads/report.pdf /tmp/report.md
```

Ответ — одна строка JSON: `{"ok":true,"path":…,"pages":12,"chars":48213,"images":0}`.

Конвертация в `sup` по умолчанию выключена — после установки её включают переменной
на один запуск или в `.env`:

```sh
USE_PDF_CONVERT=true sup
```

Внутри сессии — `/pdf on`, разовая конвертация без флага — `/pdf <path>`.
