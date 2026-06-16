# UzMRC — статус и точка возврата

**Обновлено:** 2026-06-16

## 🟢 Сессия 2026-06-16 (2) — ⭐ EMBEDDING-КЭШ (Tier-0) реализован и проверен на живом Postgres
Главный невзятый фикс закрыт: реиндекс того же корпуса больше НЕ жжёт квоту эмбеддера.
- **Модель `EmbeddingCache` + миграция `0007_embedding_cache`** (Postgres): `hash` PK = `sha256(model_sig | text)`, `model_sig`, `dim`, `vector` JSONB, `created_at`.
- **`embeddings.model_signature()`** → `provider:model:dim` — namespace кэша. Смена эмбеддера = новый sig → старые векторы не «протекают» в другое embedding-пространство.
- **`ingestion/embed_cache.py::embed_with_cache(db, texts, ...)`** — bulk-lookup кэша → эмбеддит только промахи → `ON CONFLICT DO NOTHING` персист. Порядок и дубли сохраняются (1 вектор на позицию входа, уникальный текст эмбеддится 1 раз).
- **`pipeline.py`** переключён на `embed_with_cache` (прокинута `db`-сессия).
- **Тесты `tests/test_embed_cache.py`** — 7 кейсов (cold→warm, partial-hit, dup-once, изоляция по model_sig, пустой, all-hit прогресс, namespacing ключа). Итого по эмбеддингам **13/13 зелёных**, ruff чисто.
- **Живая проверка на реальном Postgres (контейнер postgres:16):** `alembic upgrade head` прошёл до 0007; cold→warm round-trip — при повторном реиндексе **эмбеддер не вызван** (total embed calls = 1), JSONB round-trip корректен (float), кросс-язык (кириллица+узбекский) и дубли ОК. **LIVE VERIFY: PASS.**
- **Эффект:** вчерашняя боль (4 реиндекса = 4× квота Voyage 3RPM/Gemini RPD) устранена — реиндекс теперь мгновенный и бесплатный.

## 🟢 Сессия 2026-06-16 (1) — token-aware суб-батчинг эмбеддингов + тесты
Докоммичен код прошлой сессии и закрыт пробел в покрытии.
- **`embeddings.py::embed_documents_batched`** (OpenAI-совместимый путь): суб-батчи теперь ограничены ОБОИМ — числом чанков (`batch_size`) И оценкой токенов (`embed_tpm * 0.6`, фолбэк 18000). Один запрос больше не пробивает TPM-cap free-тарифа (Gemini free = 30K TPM → 64 длинных чанка в одном запросе = 429).
- **Новый тест `tests/test_embeddings_batching.py`** — 6 кейсов (token-budget split, count-limit, oversized-single, default-budget, порядок, пустой ввод). Все зелёные. Раньше суб-батчинг был без прямого покрытия.
- Тесты гоняются нативно (Python 3.14): нужны `voyageai`, `tiktoken`, `fastembed` доустановкой; compare-тесты тянут `fastembed`→onnx (тяжело) — для полного прогона предпочтительнее Docker-образ.
- Очищены транзиентные ingest-артефакты в `.gitignore` (`.ingest_state`, `.ragid.new`, `.oldrag_files.txt`, `.upload_paths.txt`).
- **Новый док `notes/zero-budget-playbook.md`** — свод выходов из free-tier лимитов (Tier 0–4). Главный вывод: **#1 невзятый фикс — embedding-кэш по `sha256(provider+model+text)`**, который убирает пере-жигание квот при реиндексе (вчера сожгли квоту 4 реиндексами одного корпуса).

## 🟢 Сессия 2026-06-15 — оба модуля РАБОТАЮТ end-to-end на $0
Полностью бесплатный стек поднят локально, оба модуля доказаны на реальном корпусе.

**Финальный free-стек (всё в `rag-cms/.env`, gitignored):**
- **Эмбеддинги: Voyage** `voyage-3.5` (1024-dim, multilingual). `EMBED_PROVIDER=voyage`, `VOYAGE_API_KEY`, `VOYAGE_EMBED_MODEL=voyage-3.5`, `VOYAGE_EMBED_DIM=1024`. Free 200M токенов. **DeepInfra/bge-m3 отброшен** (был $0-блокер).
- **LLM-судья: Cerebras** `gpt-oss-120b`. `LLM_API_BASE_URL=https://api.cerebras.ai/v1`, `LLM_API_KEY=csk-...`, `LLM_MODEL=gpt-oss-120b` (+ rerank те же). Free **1M токенов/день** — крупнейший free дневной бюджет. OpenAI-совместим, JSON-mode есть.
- **Запуск:** `docker compose -f docker-compose.prod.yml up -d --build` (deepinfra-оверлей больше НЕ нужен). Порт postgres сменён 5433→5435 (5433 занят нативным Windows-postgres). Bootstrap-админ: `admin@uzmrc.io` / `UzmrcAdmin2026!` (email `.local` отвергался валидатором EmailStr — заменён на `.io`).

**Результаты на корпусе (RAG id `4065a368-96b3-4225-b599-33c41af96a3a`, 83 дока txt, 258 чанков):**
- **Модуль 1 (retrieval) ✅** — вкл. кросс-язык: русский запрос «антикоррупционная политика» вытащил и русский `kodeks-etiki`, и узбекский `qoidabuzarliklar`. Voyage multilingual матчит ru↔uz.
- **Модуль 2 (compare) ✅ ПОЛНОЕ ЗЕЛЁНОЕ** — прогон на `qoidabuzarliklarhaqida` (уже в корпусе): **45/45 duplicate, matched 45/45, grounded 29/45, 0 провалов, 164с.**

**Что доработано в коде этой сессии (важно — НЕ закоммичено, см. ниже):**
1. **Батч-эмбеддинг запросов** (`clients/voyage.py::embed_queries_batched`, `clients/embeddings.py::embed_queries`, `retrieval/hybrid.py` param `query_vector`): compare пред-эмбеддит все клаузы 1 вызовом вместо N. Voyage throttle устранён (188с→16с эмбеддинга).
2. **Батч-судья** (`compare/judge.py::judge_clauses_batch`, перестроен `compare/service.py`): N клауз → 1 LLM-вызов на группу (batch=6). 45 запросов → ~8. Это снимает RPM-лимиты любого free-тарифа (главный рычаг). `max_tokens` щедрый (reasoning-модель иначе обрезает JSON).
3. `clients/llm.py`: `max_retries` 1→6 (free-тарифы отдают transient 429).
4. `docker-compose.prod.yml`: проброс `LLM_API_BASE_URL`/`RERANK_API_BASE_URL`/`RERANK_API_KEY`.
5. Тесты обновлены под батч-сигнатуры — **24/24 зелёные**.

**Путь, по которому пришли к Cerebras (для контекста):** Groq (TPM 6K — мал) → Gemini Flash-Lite (TPM 250K огонь, но RPD реально =20, не 1000) → **Cerebras** (1M ток/день, низкий RPM 5 неважен из-за батчинга). Ключи Groq/Gemini тоже в `.env` как фолбэк-история.

## Демо-полировка (та же сессия) — отчёт клиент-готового качества ✅
Цель: показать MVP в высоком качестве на бесплатном стеке.
- **Демо-артефакт:** `corpus/demo/proekt-prikaza-2026.txt` — реалистичный русский «проект приказа» из 10 пунктов с заложенным миксом (дубли/конфликты/дополнения/пробелы) против реальных норм базы. Это центральный демо-сценарий (критерий приёмки №3).
- **Результат `/compare` (детерминированно, 0 ошибок):** 3 конфликта (компетенция ГД, запрет анонимных сообщений, подарки 5 млн), 2 дубля (исполн.орган, антикоррупция — grounded), 2 дополнения, 3 пробела (срок, удалёнка, ESG). Кросс-язык ru→uz в деле.
- **UI (порт 8090) проверен вживую** (Playwright): логин → /compare → загрузка → KPI-карточки + сортировка «противоречия сверху» + бейджи + обоснование + норма с дословной цитатой и индикатором «подтверждена» + рекомендация. Скриншоты сделаны.

**Фиксы надёжности судьи (код, НЕ закоммичено):**
6. **Кросс-провайдер фолбэк** (`judge.py::_judge_call`, `config.py`, compose): primary Cerebras → fallback Gemini (`LLM_FALLBACK_*`). Ни один провайдер — не single point of failure.
7. **Robust JSON-парсинг** (`_loads_lenient`): brace-extraction + `strict=False` (управляющие символы) + срез trailing-comma. Лечит битый JSON reasoning-моделей.
8. **max_tokens судьи 700→3000** (per-clause) — reasoning-модель (gpt-oss) больше не обрезается на полуслове → исчезли `Unterminated`-падения. Главный фикс: 3/3 прогона с 0 ошибок.
9. **Per-clause фолбэк** при сбое батча + **чистка преамбулы** в splitter (заголовок/титул больше не попадает в положения).
- **Текущий стек судьи:** primary `gpt-oss-120b` (Cerebras), fallback `gemini-2.5-flash-lite`. Для максимального grounding можно сделать Gemini primary, когда у него свежий дневной RPD.

## ✅ Версионирование (решено 2026-06-15)
Приватный репо **`Yersultan04/uzmrc`** (github.com/Yersultan04/uzmrc), ветка `main`, коммит `9d6a32e`. Провенанс rag-cms подтверждён владельцем (использовать можно). `.gitignore`: исключены `.env` (все ключи), `*.tok`, PDF корпуса (рескрейпятся), node_modules/.venv/data. В репо: код rag-cms + наши правки, corpus txt + манифесты + demo, notes, scraper. Секрет-скан перед пушем — чисто. **Дальше: коммитить/пушить после каждой задачи.**

---

## Где мы (платформа)
- **Корпус собран ✅:** `corpus/normative/` 36 PDF + txt, `corpus/mvp50/` 47 PDF + txt (= 83 дока). В манифестах есть 404 на части аналитики — дочистить позже.
- **Платформа rag-cms ✅:** backend (agent/api/clients/ingestion/retrieval), docker-compose local/prod/onprem. Docker работает (v29.2.1).
- **Модуль 2 (Сравнение документов) ✅ РАБОТАЕТ:** код + батч-архитектура, протестирован (24/24).

## Решения сессии 2026-06-14
- **Эмбеддер: bge-m3 через DeepInfra (облако).** Локальный запуск отвергнут — на ноуте (7.8 GB) свободно ~1.1 GB против нужных ~3 GB. DeepInfra: та же модель, ноут свободен, ~центы за весь корпус.
  - `.env`: `EMBED_API_BASE_URL=https://api.deepinfra.com/v1/openai`, `EMBED_MODEL_NAME=BAAI/bge-m3`, `EMBED_DIM=1024`.
  - Оверлей `docker-compose.deepinfra.yml` (пробрасывает EMBED_* в backend, без TEI-контейнера).
- **БЛОКЕР DeepInfra:** ключ валиден, но на аккаунте $0 баланс (HTTP 402). Нужно пополнить ~$5 картой на https://deepinfra.com/dash/billing. До этого реальный ингест и финальный тест ru/uz заблокированы.
- **LLM:** OpenRouter gpt-4o-mini (в `.env`). Менять не надо.

## Модуль 2 — что сделано (код, без ингеста)
Backend `backend/app/compare/`:
- `schemas.py` — ClauseRelation (duplicate/conflict/addition/gap), ClauseFinding, CompareReport, JudgeVerdict.
- `splitter.py` — режет регламент на положения (нумерация статей/пунктов RU/UZ, таблицы атомарно, фоллбэк на chunker, hard-split длинных).
- `grounding.py` — проверка цитаты против текста нормы (substring/loose/fuzzy).
- `judge.py` — LLM-судья (gpt-4o-mini, JSON), деградация в gap при ошибке, guard индекса кандидата.
- `service.py` — оркестратор: parse → split → retrieval-per-clause (hybrid_search) → judge → grounding → агрегат, concurrency=5, лимит 120 положений.
- `api/compare.py` — `POST /api/rags/{id}/compare` (upload файла, временно, не индексируется), зарегистрирован в `main.py`.
- Тесты `backend/tests/test_compare_*.py` — 24 шт, моки на hybrid_search + LLM (эмбеддер НЕ нужен). `pyproject.toml`: asyncio_mode=auto.

Frontend:
- `api.ts` — типы CompareReport и метод `compareDocument` (multipart, XHR с прогрессом).
- `pages/RagCompare.tsx` — загрузка + отчёт (KPI, карточки находок, цвет по типу, индикатор grounded).
- роут `rag/:id/compare` в `main.tsx`, кнопка «Сравнить документ» в шапке `RagDetail`.

Проверено в Docker: py_compile ✅, ruff ✅ (кроме пре-существующих B008/UP042), pytest 24/24 ✅. Образ `ragcms-backend:test` собран.

## Next Action (когда вернёмся)
1. **✅ СДЕЛАНО — Embedding-кэш (Tier 0)** — реализован, проверен на живом Postgres (см. сессию 2026-06-16(2)). Реиндекс больше не жжёт квоту.
2. **Прогнать реальный реиндекс через стек** — поднять `docker-compose.prod.yml`, `alembic upgrade head`, переиндексировать корпус (id `4065a368-...`): первый проход наполняет `embedding_cache`, повторный должен пройти на 0 вызовов эмбеддера. Подтвердить эффект на боевом корпусе (258 чанков).
3. **Демо для клиента:** прогнать `/compare` на «чужом» приказе (не из корпуса), показать вердикты conflict/addition/gap, а не только duplicate. Бюджет Cerebras ~1M ток/день (≈9 compare).
3. **Фаза 3 (UX):** async-воркер для `/compare` + SSE (инфра есть в ingest) — снимает синхронный лимит, длинные регламенты на free-тарифе идут в фоне.
4. **Grounding:** поднять долю grounded (сейчас 29/45) — судья иногда перефразирует quote вместо дословной выдержки; ужесточить промпт/фолбэк на дословный фрагмент кандидата.
5. **Вилка цены/срока MVP** для оффера (vs SimbirSoft $56–66K, 3–5 мес).

## Стартовый чек-лист подъёма стека (проверено 2026-06-15)
1. `cd rag-cms && docker compose -f docker-compose.prod.yml up -d --build` (порты: backend 8088, postgres 5435, qdrant 6335).
2. Login: `POST :8088/api/auth/login {"email":"admin@uzmrc.io","password":"UzmrcAdmin2026!"}` → Bearer-токен.
3. RAG уже существует (id `4065a368-...`, 83 дока, fts=russian, Voyage). Новый: `POST /api/rags`.
4. Тест M1: `POST /api/rags/{id}/search {"query":"...","mode":"hybrid","top_k":3}`.
5. Тест M2: `POST /api/rags/{id}/compare` (multipart `file=@...`).

## Открытые вопросы (из MVP-PLAN)
- **Происхождение/лицензия rag-cms (наша или чужая основа)** — блокирует решение о git/публикации.
- Качество узбекского retrieval — ✅ проверено на реальном корпусе (работает, вкл. кросс-язык).
- Вилка цены/срока MVP для оффера клиенту (vs SimbirSoft $56–66K, 3–5 мес).
- Техдолг rag-cms: воркер на BackgroundTasks не переживает рестарт; удаление файла не чистит Qdrant; нет .env.example.
- Compare endpoint синхронный — для больших регламентов вынести в фоновый воркер с SSE (инфра есть в ingest).
