# converters/marker — установка

Fedora 42 в WSL2. Все команды подряд, от обычного пользователя.

```sh
mkdir -p ~/.local/bin ~/.local/share/marker
python3 -m venv ~/.local/share/marker/venv
~/.local/share/marker/venv/bin/pip install -U pip wheel

# torch — отдельно и до marker, иначе pip притянет CUDA-стек на несколько гигабайт
~/.local/share/marker/venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
~/.local/share/marker/venv/bin/pip install -r ~/dev/my-sup/converters/marker/requirements.txt

cp             ~/dev/my-sup/converters/marker/convert.py ~/.local/share/marker/convert.py
install -m 755 ~/dev/my-sup/converters/marker/pdf-to-md  ~/.local/bin/pdf-to-md

# модели surya (~3.4 ГБ) — через curl -C -, можно прерывать и запускать снова
~/dev/my-sup/converters/marker/fetch-models
```

Проверка:

```sh
pdf-to-md ~/Downloads/report.pdf /tmp/report.md
```

Ответ — одна строка JSON: `{"ok":true,"path":…,"pages":12,"chars":48213,"images":0}`.
