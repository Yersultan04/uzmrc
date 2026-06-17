# UzMRC — быстрый запуск

ИИ-ассистент по нормативным документам: чат с цитатами (ru/uz) + сравнение документов (поиск противоречий/дублей/пробелов).

Репозиторий: https://github.com/Yersultan04/uzmrc

---

## 1. Что нужно установить

- **Docker Desktop** (Windows или Mac) — должен быть установлен и **запущен**.
- **git** — для скачивания проекта.
- **cloudflared** — только если хочешь публичную ссылку (см. шаг 4).

---

## 2. Скачать и настроить

```bash
git clone https://github.com/Yersultan04/uzmrc.git
cd uzmrc/rag-cms
```

Создай файл `.env` в папке `rag-cms/`. Возьми за основу `.env.example` (в нём подсказки по каждой строке) и впиши ключи.

**Ключи (большинство бесплатные):**

| Строка в .env | Где взять | Цена |
|---------------|-----------|------|
| `LLM_API_KEY` + `RERANK_API_KEY` | cloud.cerebras.ai → API Keys (один ключ в обе строки) | бесплатно (1M токенов/день) |
| `VOYAGE_API_KEY` | voyageai.com → Dashboard → API Keys | бесплатно (200M токенов) |
| `EMBED_API_KEY` | aistudio.google.com → Get API Key | бесплатно |
| `OPENROUTER_API_KEY` + `LLM_FALLBACK_API_KEY` | openrouter.ai → Keys | необязательно (можно пусто) |

Свои локальные секреты (придумай любые):
- `POSTGRES_PASSWORD` — любой пароль для БД
- `JWT_SECRET` — сгенерируй: `python -c "import secrets; print(secrets.token_urlsafe(48))"`
- `BOOTSTRAP_ADMIN_EMAIL` — например `admin@uzmrc.io`
- `BOOTSTRAP_ADMIN_PASSWORD` — твой пароль для входа

---

## 3. Запустить

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Первый раз собирается несколько минут. Потом открой:

**http://localhost:8090**

Войди под `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` из своего `.env`.

Остановить:
```bash
docker compose -f docker-compose.prod.yml down
```

> ⚠️ База при первом запуске **пустая**. Тексты корпуса лежат в репо (`corpus/normative_txt/`, `corpus/mvp50_txt/`). В интерфейсе: создай RAG (язык поиска `russian`) → загрузи txt-файлы → нажми «Индексировать». Первая индексация ~5–7 минут (бесплатный тариф эмбеддингов), дальше быстро.

---

## 4. Публичная ссылка (по желанию, бесплатно)

Чтобы дать доступ другим без своего ПК у них — подними туннель Cloudflare. Регистрация и домен **не нужны**.

Установить cloudflared (один раз):
- **Windows:** `winget install --id Cloudflare.cloudflared`
- **Mac:** `brew install cloudflared`

Запустить туннель (стек уже должен работать):
```bash
cloudflared tunnel --url http://localhost:8090
```

В выводе появится твой адрес вида `https://xxxxx.trycloudflare.com` — это публичная ссылка на твою копию. Закрыть окно / `Ctrl+C` — туннель остановится.

**Важно:**
- Пока туннель работает, твой ПК должен быть включён.
- URL меняется при каждом запуске (постоянный адрес — только с доменом в Cloudflare).
- Порт `8090` = фронтенд. Если поменял `FRONTEND_PORT` в `.env` — подставь свой.

---

## Если что-то не работает

- Docker Desktop запущен? Проверь иконку в трее.
- Порты `8090`, `8088`, `5435`, `6335` свободны? Закрой то, что их занимает, или поменяй в `.env`.
- Логи: `docker compose -f docker-compose.prod.yml logs -f backend`
