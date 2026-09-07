# optional/searxng — поиск без ключа

`web_search` по умолчанию ходит в `ollama.com/api/web_search` и требует `OLLAMA_API_KEY`.
Свой инстанс SearxNG заменяет его целиком: ключ не нужен, аккаунта и часового лимита нет,
выдача та же — заголовки и URL. Запросы инстанс всё равно раздаёт поисковым движкам, но от
вашего имени и без посредника. Docker в WSL2, все команды от обычного пользователя.

```sh
mkdir -p ~/.config/searxng
cp ~/dev/sup/optional/searxng/settings.yml ~/.config/searxng/settings.yml
sed -i "s/REPLACE_WITH_OWN_SECRET/$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")/" ~/.config/searxng/settings.yml

docker run -d --name searxng-sup --restart unless-stopped \
  -p 8888:8080 \
  -v ~/.config/searxng:/etc/searxng \
  searxng/searxng:latest
```

Проверка — ответ должен быть `application/json`, а не html:

```sh
curl -s "http://localhost:8888/search?q=nodejs&format=json" -o /dev/null -w '%{http_code} %{content_type}\n'
```

Три строки в `settings.yml` существуют ради `sup`:

| Строка | Зачем |
|---|---|
| `search: formats: [html, json]` | без неё инстанс отдаёт только html и отвечает `403` на `format=json` |
| `server: limiter: false` | лимитер отсекает запросы без браузерных заголовков, а `sup` ходит обычным `fetch` |
| `server: secret_key` | свой у каждого инстанса; в репозитории лежит заглушка, замените |

`sup` берёт адрес из `WEB_SEARCH_HOST`, поэтому проверка приватных адресов к нему не
применяется — как и к `OLLAMA_HOST`:

```sh
WEB_SEARCH_PROVIDER=searxng
WEB_SEARCH_HOST=http://localhost:8888
```

Внутри сессии провайдера переключает `/search-provider` — он меняет только имя провайдера,
`WEB_SEARCH_HOST` остаётся из `.env`, так что адрес инстанса имеет смысл держать там всегда:
тогда `/search-provider searxng` работает сразу. `WEB_SEARCH_HOST` читает только `searxng` —
у `ollama` адрес зашит в провайдере.

Ошибки инстанса доезжают до модели текстом: `SearxNG at http://localhost:8888/search returned
HTTP 403 … The instance answers json only when its settings.yml has search: formats: [html, json].`

Если контейнер пересоздать без `-v ~/.config/searxng:/etc/searxng`, SearxNG сгенерирует свой
`settings.yml` внутри контейнера, и поиск вернётся к `403`: настройка живёт в смонтированном
каталоге, а не в образе.
