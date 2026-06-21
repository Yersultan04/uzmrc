# UzMRC — статус и точка возврата

**Обновлено:** 2026-06-21

## 🟢 Сессия 2026-06-21 (11) — закрыт хвост полного корпуса + старт редизайна фронта на Next.js

### Трек B — полный корпус на проде ✅ ЗАКРЫТ
- Индексация RAG `86e90882` («UzMRC — полный корпус сайта») **завершена** (лог `DONE`, ~3 ч). Статус **ready**, **499 файлов / 5886 чанков**.
- `verify_retrieval.py` (8 запросов ru/uz): **7/8 точных попаданий**, кросс-язык ru↔uz работает. Слабый только «требования к банкам-партнёрам рефинансирования» — вероятный пробел корпуса (нет профильного дока), не поломка retrieval.
- **Переключать в коде/конфиге было нечего:** старый rag_id нигде не захардкожен, `AboutSystem` тянет живые stats, единственный юзер = `admin@uzmrc.io` (видит все базы). «Переключение демо» = просто открывать новую базу.
- **Старый RAG `348ee81f` («UzMRC Corpus (PDF, страницы)», 46/1552) удалён** по решению юзера (`DELETE /api/rags/...` → 204). На проде осталась 1 база, сирот-чанков 0, эмбеддинг-кэш сохранён.

### Трек A — редизайн фронта на Next.js ✅ СОБРАН (не задеплоен)
- Решение юзера: **полный редизайн фронта на Next.js**, кодовая база `shared-ai-project` (Next.js 16 + React 19 + Zustand + shadcn/ui `base-nova` + Tailwind v4) как фундамент, под наш существующий FastAPI-бэк. Действующий React+Vite фронт остаётся на проде до готовности нового. Новый — в `rag-cms/frontend-next/`.
- **Этап 1 (Maya)** — фундамент: чистка от банковских фич (MCP/HITL/cashier/confluence/agents/eval, ценное вынесено в `_reference/`), API-слой `lib/{api,types,auth,store}.ts` + SSE-хелперы под наш контракт, auth/middleware, rewrite `/api`→`:8088`. Коммит `55f986a`.
- **Этап 2 (Maya+Zara, параллельно)** — экраны: AppShell+навигация, список баз, детали базы (вкладки Файлы/Индексация/О системе/Участники/Настройки, owner-vs-участник), чат с кликабельными цитатами 【n】 (порт из `_reference`; токенного стрима нет — рефетч сессии по `stream_end`), **RagCompare с нуля** (KPI/фильтр-чипы/находки судьи+grounding/экспорт md+print), админ-пользователи. Жаргон вычищен. Коммит `9a5404b`.
- **Этап 2b** — Shield (security) + Kai (QA). Коммит `8a234e8`.
  - **Shield:** блокеров нет. Fixed: cookie `SameSite=Strict`+`Secure` (`lib/auth.ts`), open-redirect в логине. Markdown-XSS — sanitize на месте. Accepted LOW: stream_token в URL, client-side admin-guard. **Эскалации на бэкенд (Maya):** (1) httpOnly+Secure cookie от сервера (полный фикс кражи токена через XSS), (2) подтвердить server-side authz на `/auth/users*` и per-rag эндпоинтах. Non-blocking: удалить `_reference/`, добавить CSP-заголовок.
  - **Kai: readiness 84/100, PASS (gate ≥80), ship-eligible на staging.** Build/tsc/lint зелёные from scratch (7 роутов). Smoke (Playwright, mocked API + реальный login-флоу): все 5 роутов рендерятся, auth-guard 307→`/login` работает. 2 LOW: chat `active.runs.map` без гарда (mock-артефакт, реальный бэк всегда даёт `runs[]`), React #418 hydration на хард-релоаде auth-страниц (recoverable, фикс — SSR-стабильный плейсхолдер). Поправил dead import в `lib/api.ts`.

### ⏭️ Остаток по фронту до прод-деплоя (НЕ сделано)
1. **Live-backend E2E** — поднять postgres+backend (uzmrc-overlay/прямой), `next start` на `BACKEND_URL=:8088`, прогнать те же 5 роутов против реальных данных (login→базы→детали→чат с цитатами→compare с SSE). Закрывает −3 smoke и большую часть deploy-гэпа (→ ~92).
2. **Wire в деплой:** `docker-compose.prod.yml` (строка ~84) `frontend.build.context` всё ещё `./frontend` (старый React+Vite) → перенацелить на `./frontend-next` + согласовать порт (Dockerfile `EXPOSE 8300` vs compose), прокинуть `BACKEND_URL` build-arg.
3. **Staging-first** (золотое правило): сначала staging против реального бэка, потом прод.
4. Опц.: `middleware.ts`→`proxy.ts` (Next 16 deprecation), фикс #418, Shield-эскалации на бэк.

## 🟢 Сессия 2026-06-21 (10) — полный корпус сайта + UX-переделка фронта + прод-деплой

**Триггер:** аудит данных (взяли только 50/308 PDF, фронт непонятный, «чат не нажимается»).

### Данные — корпус 50 → ~504 документа (×10)
- **Аудит** (`notes/AUDIT-2026-06-21.md`): старый корпус покрывал 16% сайта, только нормативка. Скрапер брал ТОЛЬКО `/uploads/*.pdf` — весь HTML-пласт (≈586 стр) не собирался.
- **Скрапер доработан** (`scraper.py --html`): экстрактор `<main>`, сбор текста контент-страниц (uz/ru/en).
- **Перепроверка ссылок:** свежий discovery 312 PDF (было 308). Докачка 309/312 (`scraper.py --download`).
- **Итог:** ~290 PDF-с-текстом + 214 HTML = **~504 содержательных документа**. 20 PDF — сканы без текста (нужен OCR), 2 битые ссылки на сайте, refinance-programm/tahliliy-malumotlar — пустые HTML (аналитика в PDF).

### Сервер — Hetzner 89.167.15.225.sslip.io (НЕ Oracle!)
- Боевой UzMRC-стек: `/opt/uzmrc/rag-cms` (НЕ git-репо, только src), `docker-compose.prod.yml`, Caddy TLS, контейнеры `ragcms-*`, backend :8088 внутри, postgres :5435, pgvector.
- **Доступ:** `ssh -i .deploy/uzmrc_oracle root@89.167.15.225` (ключ в репо `.deploy/`, имя историческое «oracle»).
- Admin: `admin@uzmrc.io` / `.env BOOTSTRAP_ADMIN_PASSWORD`.

### A5 — индексация полного корпуса (в работе на момент записи)
- Новый RAG **`86e90882`** «UzMRC — полный корпус сайта» создан на сервере, корпус залит (txt+html), индексация идёт в фоне (`nohup python3 /opt/uzmrc/ingest_server.py`, лог `/opt/uzmrc/ingest.log`, стейт `.ingest_server.json`).
- Старый RAG `348ee81f` (47 PDF) НЕ тронут — демо работает на нём.
- **ОСТАЛОСЬ когда индекс дойдёт до ready:** прогнать `scripts/verify_retrieval.py` (8 запросов ru/uz по всем пластам), переключить демо на новый RAG, обновить текст «О системе» (`AboutSystem.tsx` — захардкожено «≈35 норм.актов + ≈12 обзоров, ≈595 стр», цифры old-корпуса).

### Фронт — Фаза B, задеплоен на прод и проверен вживую (Playwright)
- B1: кнопки чата/сравнения показывают **причину** блокировки (тултип+баннер) вместо немого disabled.
- B2: кнопка «Чат» прямо на карточке готовой базы.
- B3/B4: убран dev-жаргон (RAG/Qdrant/чанки) с видимых экранов → «Базы знаний», чистые пустые состояния, крошки.
- **B6** (юзер-репорт «чат слева сверху не нажимается»): логотип-пузырь был не-кликабельной картинкой → обёрнут в ссылку «На главную».
- **Чат протестирован end-to-end на проде:** агент SUCCEEDED, ответ с цитатами 【1】【3】【6】 на вопрос про антикоррупционную политику. Работает.
- Коммиты: `a21b723`, `b2acb3a`, `dd73e6b`, `19134a2`, `c5620cb`, `c2391a0`, `63bb361`, `21c11a0`. Все в `origin/main`.
- Trello #146–156 + #168 (доска «Projects — Kanban 2026»): A1–A4, B1–B4, B6 → Done.

---

## 🟢 Сессия 2026-06-18 (9) — инфо-страница «О системе» + MVP-деливераблы
**Обновлено:** 2026-06-18

## 🟢 Сессия 2026-06-18 (9) — инфо-страница «О системе» + MVP-деливераблы
Закрыты 4 из 5 заказанных деливераблов; деплой на VPS ждёт доступа к серверу.
- **Инфо-страница «О системе» — ✅ (verified live):** backend `GET /api/rags/{id}/stats` (RagStatsOut: documents/chunks/pages/tokens/avg/by_status, один агрегат-запрос) + фронт `pages/AboutSystem.tsx` (живые KPI базы, блоки «что умеет / входит в MVP / ограничения») + пункт меню «О системе» + `api.getRagStats`. Пересобрано (prod), проверено в браузере: 50 док / 1 630 чанков / 32.6 / voyage-3.5 / 643 974 ток / «Готова». Скрин `notes/demo-shots/uzmrc-about-page.png`. (бэкенд — Maya, фронт+интеграция — Chelsea, т.к. агент Maya упал по idle-timeout не доделав фронт.)
- **10 примеров работы — ✅:** `notes/10-EXAMPLES.md`, реальные прогоны против живого API. 7 чат (вкл. uz и вопрос вне базы → budget_exhausted без фабрикации = демонстрация анти-галлюцинаций) + 3 сравнения (foreign 4confl/1dup/1add/4gap; duplicates 5/5; newtopics 5gap).
- **Техописание — ✅:** `deliverables/UzMRC-Техническое-описание.docx` (10 разделов) + исходник `notes/TECHNICAL-DESCRIPTION.md`.
- **Презентация MVP — ✅:** `deliverables/UzMRC-Презентация-MVP.pptx` (13 слайдов, бренд-акцент, скрины About+отчёт).
- **Генераторы:** `scripts/gen_examples.py`, `gen_docx.py`, `gen_pptx.py` (воспроизводимые).
- Коммит `583cd74`, запушен в origin/main.
- **❗ Остаётся:** деплой на VPS (постоянный URL) — нужен доступ к серверу. Локальный стек + Cloudflare quick tunnel работают как раньше.

## 🟢 Сессия 2026-06-17 (8) — Фаза 6 (демо), async-воркер+SSE для /compare, ребрендинг → ✅ MVP ЗАКРЫТ
**Старое обновление:** 2026-06-17

## 🟢 Сессия 2026-06-17 (8) — Фаза 6 (демо), async-воркер+SSE для /compare, ребрендинг → ✅ MVP ЗАКРЫТ
Закрыты три последних пункта: косметика, async Модуля 2, репетиция демо. Все три проверены вживую на боевом стеке.

- **Async-воркер + SSE для `/compare` (бывшая Фаза 2 C/D) — ✅** (исполнитель: Maya). `/compare` больше не блокирует запрос.
  - Backend: `compare/events.py::CompareEventBroker` (копия IngestEventBroker, диск `compare_runs/<run_id>/events.jsonl`), модель `CompareRun`+`CompareRunStatus`, миграция `0008_compare_runs` (chain 0007→0008, CASCADE+индексы), воркер `compare/worker.py::run_comparison` (своя db-сессия через SessionLocal, on_progress→broker.publish, tmp удаляется в finally, broker.pop). Endpoint переписан: `POST /{id}/compare`→202+{run_id,stream_token}; `GET .../runs/{run_id}`; `GET .../runs/{run_id}/stream?token=&since=` (SSE). `CompareRunOut` в schemas.
  - Frontend: `api.ts` — `startCompare` (202) + `streamCompare` (EventSource: onProgress/onReport/onError); `RagCompare.tsx` — прогресс-бар (upload 10% + анализ 90%), SSE cleanup при unmount, весь рендер отчёта сохранён.
  - Тесты: 30/30 старых + 6 новых (broker publish/subscribe/replay/since/pop + worker success/failure) зелёные. Ruff чисто (кроме pre-existing B008).
- **Ребрендинг «rag-cms» → «UzMRC» — ✅:** `App.tsx` (топбар «UzMRC» + «ИИ-ассистент по нормативным документам»), `Login.tsx`, `main.py` (FastAPI title/description). `index.html` уже был. localStorage-ключи `ragcms.*` оставлены намеренно (внутр. неймспейс; смена разлогинит сессии).
- **Фаза 6 (репетиция демо) — ✅ ПРОВЕРЕНО ВЖИВУЮ на боевом стеке (127.0.0.1):**
  - Пересобраны backend+frontend (`docker-compose.prod.yml`, локально), миграция `0008` применилась на старте (лог `0007→0008`), таблица `compare_runs` создана.
  - **M1 retrieval ✅** кросс-язык ru↔uz: запрос «антикоррупционная политика» → `antokorrup-politika` (0.80) + узб. `korrupsiyagaqarshi` (0.79). uz-запросы дают хиты.
  - **M2 async end-to-end ✅** на `prikaz-vnutrenniy-2026-foreign.txt` (RAG `1e852a09`): POST→202(queued), queued→running→succeeded за **23с**. Отчёт: **5 conflict / 2 duplicate / 0 addition / 3 gap**, grounding **5/7**. Судья поймал п.4 (обход набсовета) и п.9 (ИБ) как conflict с верной нормой — рост качества против прошлой сессии (было 1 conflict/4 add).
  - **SSE проверен:** последовательность `progress×2 → report → stream_end` (двойной stream_end безвреден: диск-replay + endpoint).
  - **UI вживую (Playwright):** ребрендинг «UzMRC» виден на login и в топбаре; загрузка приказа → «Сравнить» → async-прогон → тост «Готово: найдено противоречий — 4» → KPI-карточки + фильтр-чипы + экспорт .md/PDF + карточки находок с бейджами/обоснованием/цитатой норм («цитата подтверждена») + рекомендация. Скриншоты: `notes/demo-shots/uzmrc-{rebrand-login,compare-progress,compare-report-fullpage}.png`.
- **Статус MVP:** 🎉 **все 6 фаз закрыты + остаток Фазы 2 (async).** Оба модуля работают end-to-end. Остаётся только бизнес-часть: **вилка цены/срока MVP для оффера** (vs SimbirSoft $56–66K, 3–5 мес) и финальная совместная репетиция демо перед клиентом.

## 🟢 Сессия 2026-06-16 (7) — Фазы 2–5: техдолг, корпус, frontend, security+деплой
- **Фаза 4 (Frontend):** RagCompare — фильтр-чипы по типу + экспорт (.md/печать) + раскрытие текста; брендинг title. Проверено в браузере.
- **Фаза 3 (Корпус):** найдено 5/50 файлов в `parsing`/0-чанков (краш воркера) → восстановлены, корпус 50/50. Исправило п.9 ИБ (gap→conflict). Grounding: salvage + homoglyph-folding.
- **Фаза 2 (E/F):** `.env.example`; Qdrant-чистка при удалении уже в коде. (C/D async-воркер — остаток.)
- **Фаза 5 (Security+Deploy) — ✅ ГОТОВО + ЖИВОЙ DEMO:**
  - Shield-аудит + фиксы: JWT startup-guard, /docs off (`EXPOSE_DOCS`), rate-limit login 10/мин/IP (`app/ratelimit.py`), nginx security-заголовки (CSP/HSTS/...). Проверено вживую.
  - Backup `scripts/backup-db.sh` (дамп 5.5M), runbook `notes/DEPLOY-RUNBOOK.md`.
  - **Публичный demo поднят (Cloudflare Tunnel, авторизовано):** проверен end-to-end через HTTPS — страница 200, заголовки, API, login 200, CSP не ломает фронт. URL эфемерный (`*.trycloudflare.com`, живёт пока ПК+туннель онлайн; меняется при перезапуске — `cloudflared tunnel --url http://localhost:8090`).
  - Креды demo: `admin@uzmrc.io` / см. `.env` `BOOTSTRAP_ADMIN_PASSWORD`.
- **Статус MVP:** ядро + оба модуля готовы; 5/6 фаз закрыто. Осталось: Фаза 6 (репетиция демо, совместно) + опц. Фаза 2 C/D (async-воркер для длинных регламентов). Косметика: внутренние надписи «rag-cms» → UzMRC.

## 🟢 Сессия 2026-06-16 (6) — Фаза 1: платный стек + Voyage reranker (точность retrieval)
- **Платный стек:** Voyage billing + OpenRouter credits активны. Замер: OpenRouter gpt-oss судья=130с vs Cerebras=14с → **гибрид**: Voyage (эмбеддинги, paid) + Cerebras gpt-oss-120b (судья/rerank, 14с) + OpenRouter paid (фолбэк). `.env` (gitignored), бэкап `.env.bak.*`.
- **Voyage reranker `rerank-2.5`** в Модуле 2 (`compare/service.py::_rerank_hits`, `clients/voyage.py::rerank`, config `voyage_rerank_model`): retrieval-пул 10 → rerank → топ-5 судье. Фолбэк-цепочка Voyage → LLM-rerank → raw.
  - LLM-rerank (gpt-oss) пробовал первым: качество ОК, но **201с** (RPM-шторм Cerebras: 9× 429, ретраи 60с) + хрупкий JSON. Voyage rerank снял обе проблемы.
  - **Демо-приказ: grounding 4/6 → 6/6 (100%), 21с, нормы тематически корректны.** п.4 (обход набсовета) addition→**conflict grounded** ✅. п.9 (ИБ)→gap (безопасно, recall, чинится Фазой 3).
  - 3 новых rerank-теста, 7/7 compare-тестов зелёные, ruff чисто.
- Артефакты: `notes/MVP-ROADMAP.md` (end-to-end план, 6 фаз, demo-ready 30 июн), `notes/compare-demo-foreign-prikaz.{md,json}` (v5).

## 🟢 Сессия 2026-06-16 (5) — закалка Модуля 2, item #1: промпт судьи (conflict-detection)
Демо вскрыло, что судья помечает ослабление/обход нормы как «addition». Переписаны промпты `compare/judge.py`:
- Общий блок правил `_RELATION_RULES` (DRY single+batch), 4-шаговая процедура выбора relation, тест «conflict = нельзя исполнить, не нарушив норму», few-shot примеры (conflict/duplicate/addition), запрет over-flag. Дословность quote усилена.
- Итерации: v2 (тай-брейкер «при сомнении conflict») перестарался (5 conflict / 0 add / 0 dup) → откат к балансу v3.
- **Результат на «чужом» приказе: было 1 conflict/1 dup/4 add/4 gap → стало 3 conflict / 1 dup / 2 add / 4 gap.** Целевые фиксы пойманы: п.2 (подарки 10 МРОТ) addition→**conflict**; п.3 (анонимные) дубль сохранён; п.1 (декларация КИ) остался addition (не ложный conflict). 9 тестов судьи зелёные, ruff чисто.
- Остаточные промахи пп.4 (обход набсовета) и 9 (ИБ на чужую норму) — упираются в **точность retrieval (item #2, следующий)**, не в судью. Артефакт: `notes/compare-demo-foreign-prikaz.md`.

## 🟢 Сессия 2026-06-16 (2) — ⭐ EMBEDDING-КЭШ (Tier-0) реализован и проверен на живом Postgres
Главный невзятый фикс закрыт: реиндекс того же корпуса больше НЕ жжёт квоту эмбеддера.
- **Модель `EmbeddingCache` + миграция `0007_embedding_cache`** (Postgres): `hash` PK = `sha256(model_sig | text)`, `model_sig`, `dim`, `vector` JSONB, `created_at`.
- **`embeddings.model_signature()`** → `provider:model:dim` — namespace кэша. Смена эмбеддера = новый sig → старые векторы не «протекают» в другое embedding-пространство.
- **`ingestion/embed_cache.py::embed_with_cache(db, texts, ...)`** — bulk-lookup кэша → эмбеддит только промахи → `ON CONFLICT DO NOTHING` персист. Порядок и дубли сохраняются (1 вектор на позицию входа, уникальный текст эмбеддится 1 раз).
- **`pipeline.py`** переключён на `embed_with_cache` (прокинута `db`-сессия).
- **Тесты `tests/test_embed_cache.py`** — 7 кейсов (cold→warm, partial-hit, dup-once, изоляция по model_sig, пустой, all-hit прогресс, namespacing ключа). Итого по эмбеддингам **13/13 зелёных**, ruff чисто.
- **Живая проверка на реальном Postgres (контейнер postgres:16):** `alembic upgrade head` прошёл до 0007; cold→warm round-trip — при повторном реиндексе **эмбеддер не вызван** (total embed calls = 1), JSONB round-trip корректен (float), кросс-язык (кириллица+узбекский) и дубли ОК. **LIVE VERIFY: PASS.**
- **Эффект:** вчерашняя боль (4 реиндекса = 4× квота Voyage 3RPM/Gemini RPD) устранена — реиндекс теперь мгновенный и бесплатный.
- **✅ ПРОВЕРКА НА ПОЛНОМ БОЕВОМ СТЕКЕ (`docker-compose.prod.yml`, 2026-06-16):** backend пересобран с кэш-кодом → на старте `alembic upgrade head` применил `0007` в контейнере, таблица `embedding_cache` создана. Контролируемый прогон на свежем RAG из 4 реальных корпус-txt (Voyage `voyage-3-lite`, 14 чанков):
  - **Холодный ингест:** ~56 с (пейсинг Voyage 3RPM), `embedding_cache` наполнен до **14 строк**.
  - **Тёплый реиндекс `POST /index?force=true`** (сбрасывает parsed→uploaded, вайпит чанки, ре-эмбеддит): **5 с**, `embedding_cache` остался **14 строк (0 новых эмбеддингов)**, 14 чанков пересозданы. → **эмбеддер не вызван ни разу.** Тестовый RAG удалён, записи кэша сохранены (content-addressed, переиспользуются).
  - Минорный observability-пробел: `log.info("embed cache: …")` (логгер `ingestion`) не пробрасывается в uvicorn-stdout — на корректность не влияет, но стоит включить для наблюдаемости hit-rate в проде.

## 🟢 Сессия 2026-06-16 (3) — масштаб-демо кэша + фикс логирования (оба проверены вживую)
- **Фикс логирования (`main.py`, коммит `6bbd36a`):** app-логгеры (`ingestion`, `startup`) не имели хендлера — uvicorn конфигурит только свои. Добавлен `logging.basicConfig(level=LOG_LEVEL|INFO)` на импорте. **Проверено:** в stdout теперь видно `INFO [ingestion] embed cache: N texts, X hits, Y to embed (model_sig=…)`.
- **Масштаб-демо на полном стеке (Voyage `voyage-3-lite`, 15 доков → 182 чанка):**
  - **Холодный:** 386 с (~6.4 мин, пейсинг Voyage 3 RPM), кэш +181 строка, логи `0 hits, N to embed`.
  - **Тёплый реиндекс `force=true`:** **5 с (×77 быстрее)**, новых строк в кэше **0**, логи `N hits, 0 to embed`. → эмбеддер не вызван ни разу на 182 чанках.
- **Побочное наблюдение (важно для выбора эмбеддера):** пробовал масштаб на env-дефолте **Gemini `gemini-embedding-001`** — упёрся в free RPD-лимит (27× `RateLimitError`, большинство файлов не проэмбедились). Token-aware суб-батчинг снижает число запросов, но дневной RPD Gemini для эмбеддингов всё равно слишком мал для bulk-ингеста → для холодного наполнения кэша надёжнее Voyage (медленно, но доходит) или self-host bge-m3 (Oracle/Kaggle, см. playbook). После наполнения кэша провайдер уже неважен — реиндекс бесплатен.
- Тестовые RAG удалены; кэш-строки (7 gemini + 181 voyage-3-lite) оставлены как есть (content-addressed, безвредны).

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
2. **✅ СДЕЛАНО — реальный реиндекс через стек** проверен на полном `docker-compose.prod.yml` (см. сессию (2) выше): тёплый реиндекс = 5с, 0 вызовов эмбеддера. Опционально позже: прогнать на большом Voyage-RAG `1e852a09` (1158 чанков) для масштаба + включить лог hit-rate в stdout.
3. **✅ СДЕЛАНО — демо `/compare` на «чужом» приказе.** Прогнан `prikaz-vnutrenniy-2026-foreign.txt` (10 пунктов, не из корпуса) против боевого RAG `1e852a09` за 53с: **1 conflict** (кворум набсовета 1/3 vs норма 75% — верный флагманский catch), 1 duplicate, 4 addition, 4 gap; grounding 4/6. Кросс-язык ru↔uz работает (узб. нормы матчатся). Артефакты: `notes/compare-demo-foreign-prikaz.{md,json}`. **Выявлены слабые места → в бэклог:** (а) точность per-clause retrieval (п.9 ИБ сматчился на норму о КИ), (б) леность судьи conflict→addition (пп.2,4 — реальные противоречия помечены как дополнение), (в) grounding 4/6 (2 цитаты перефразированы).
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
