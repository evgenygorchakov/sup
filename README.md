# sup

A minimal CLI agent for local models, via [Ollama](https://ollama.com) or [llama.cpp](https://github.com/ggml-org/llama.cpp). Inspired by Claude Code and [a5c-ai/babysitter](https://github.com/a5c-ai/babysitter).

I've only tested it with models in the 27–35B range — nothing larger.

## Setup

1. Run a backend: [Ollama](https://ollama.com) (`ollama pull <model>`) or [llama.cpp](https://github.com/ggml-org/llama.cpp) (`llama-server --jinja`).
2. Copy `.env.example` to `.env`, set `PROVIDER` and the matching host (`OLLAMA_HOST` or `LLAMACPP_HOST`)/`MODEL`.
3. `npm link`, then run `sup` in any directory.

## Usage

- Type `/` to see commands (`Tab` completes): switch model, toggle plan / auto / thinking / verbose output, list saved plans, clear history.
- Three modes, like Claude Code; `Shift+Tab` cycles them in place (the prompt indicator updates immediately):
  - **normal** — asks `[y / n / type feedback]` before mutating edits (`write_file`/`edit_file`) and before non-allowlisted shell commands.
  - **auto** (`[auto]`) — auto-approves edits without asking; shell still goes through the read-only allowlist (anything else still asks).
  - **plan** (`[plan]`) — read-only investigation, then a Markdown plan you approve before any edits run.
  - Pick the starting mode with `USE_PLAN_MODE` / `USE_AUTO_MODE`, or switch at runtime with `Shift+Tab`, `/plan-mode`, `/auto-mode`.
  - **`--dangerously-skip-permissions`** — like Claude Code, bypasses every approval prompt for the whole session: edits and shell commands run without asking, regardless of mode or the shell allowlist. The prompt shows a red `[skip-perms]` indicator. Only use it when you trust the model and the working directory.
- Tuned for small local models: low default temperature, tool arguments validated against the schema with precise repair errors, the approved plan re-injected near the end of the context every turn, old tool outputs collapsed to keep the context short. Models without native tool calling fall back to prompt-engineered tools (`USE_NATIVE_TOOLS=false`).
- Every setting is an `.env` variable with a sane default — see `.env.example`.
- Defaults to Ollama; switch to llama.cpp for a single run with `sup --llama` (or `sup --provider <name>`) without touching `.env`. The active provider and model are printed at startup.
- `AGENTS.md` in the working directory is appended to the system prompt.
- Skills (like Claude Code skills): drop `.sup/skills/<name>/SKILL.md` with a `description` in the frontmatter (the skill name is the folder name); the body is loaded on demand via the `skill` tool.
- Paste an image from the clipboard

## Babysitter mode

Представьте, что модель — это юный стажер, который знает свою работу, но часто забывает, на каком этапе он остановился, перескакивает через пункты и говорит «всё готово», даже не проверив. Babysitter — это строгий наставник, который стоит у него за плечом и не дает халтурить. Важно понимать: этот наставник — не сама модель, а внешний механизм (харнесс), который помогает ей следовать правилам.

По умолчанию этот механизм отключен. Чтобы его активировать, нужно включить USE_BABYSITTER=true. После этого Babysitter начинает выполнять четыре важные задачи.

### Четыре задачи Babysitter

1. Держит список дел перед глазами. Когда начинается новая задача (например, одобрен план или загружен скилл с шагами), Babysitter берет пронумерованный список шагов и перед каждым ответом модели показывает ей этот чек-лист: «Вот твои задачи. Шаг 1 выполнен? Нет? Тогда занимайся шагом 3, не перескакивай». Модель отмечает выполненные шаги в проedger_update. Это помогает ей не терять нить.
2. Не верит на слово, что «всё готово». Когда модель пытается завершить задачу, Babysitter проверяет, были ли выполнены все необходимые команды проверки.
* Если команды есть, Babysitter запускает их самостоятельно. Если все проходит успешно, модель может завершить работу. Если нет, Babysitter возвращает ошибку и требует исправить недочеты.
* Если команд нет, Babysitter просит модель выполнить проверку. Он не примет «готово», пока проверка не будет завершена. Чтобы избежать бесконечного цикла, Babysitter ограничивает количество попыток (по умолчанию — 3). После этого он прекращает проверку и позволяет завершить задачу.
3. Ведет дневник. Babysitter записывает в файл-журнал все действия модели: запросы пользователя, результаты, запуск проверок. Если запись не удалась, это не мешает продолжению работы.
4. Умеет продолжить с того места, где остановился. Благодаря дневнику Babysitter можно прервать задачу и затем возобновить ее с помощью команды sup --resume. Он поднимет журнал, восстановит диалог и список данных, а затем продолжит работу с последнего шага.

#### Как это выглядит

Один заход задачи состоит из четырех этапов:

1. Старт. Пользователь дает задание или одобряет план. Babysitter записывает задание в дневник и формирует список шагов.
2. Цикл работы. Перед каждым ответом Babysitter показывает актуальный чек-лист. Модель выполняет шаг, вызывает инструменты (правка файлов, шелл и т.п.) и отмечает выполненные шаги. Каждое действие записывается в дневник.
3. Попытка завершиться. Когда модель перестает вызывать инструменты, Babysitter запускает гейт-проверку.
4. Развилка. Если проверка не прошла, цикл продолжается. Если прошла, Babysitter фиксирует все шаги как выполненные, ставит в дневник «finish», очищает состояние и отдает финальный ответ.

## Security

- All file tools are confined to the working directory; sensitive files (`.env`, keys, credentials) are refused for both reading and writing.
- Confirmation depends on the mode (see Usage above): in **normal** mode, edits (`write_file`/`edit_file`) and non-allowlisted shell commands ask `[y / n / type feedback]`; in **auto** mode, edits run unattended but shell still respects the allowlist. Network tools (`fetch_url`/`web_search`) run without confirmation. Shell commands matching the read-only allowlist in `src/config.ts` always run unattended; in plan mode those allowlisted commands are what's available during exploration.
- The shell tool is on by default (`USE_SHELL_TOOL=false` to disable).
