# UzMRC demo — Deploy Runbook

Как поднять demo-стенд rag-cms на чистом хосте и дать клиенту HTTPS-ссылку.

## Предусловия
- Docker + docker compose v2.
- Файл `rag-cms/.env` (из `.env.example`) с заполненными ключами: `VOYAGE_API_KEY`, `OPENROUTER_API_KEY`, `LLM_API_KEY` (Cerebras), `JWT_SECRET` (≥32 симв., `python -c "import secrets;print(secrets.token_urlsafe(48))"`), `BOOTSTRAP_ADMIN_EMAIL/PASSWORD`.

## 1. Поднять стек
```bash
cd rag-cms
docker compose -f docker-compose.prod.yml up -d --build
# backend на старте сам делает `alembic upgrade head` + bootstrap-админ
```
Порты (loopback по умолчанию): frontend 8090, backend 8088, postgres 5435, qdrant 6335.
Backend ОТКАЖЕТСЯ стартовать при слабом `JWT_SECRET` (guard).

## 2. Проверка готовности
```bash
curl -s localhost:8088/health                 # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}" localhost:8088/docs   # 404 (docs off)
curl -sI localhost:8090/ | grep -i x-frame    # X-Frame-Options: DENY
```

## 3. Загрузить корпус (если чистый хост)
Залогиниться (`POST /api/auth/login`), создать RAG (`POST /api/rags`, preset `fast` = Voyage), загрузить txt (`POST /api/rags/{id}/files`, поле `files=`), индексировать (`POST /api/rags/{id}/index`). Либо восстановить дамп (шаг 5).

## 4. Публичный HTTPS-URL
Три варианта (выбор зависит от среды клиента):

**A. Cloudflare Quick Tunnel** (быстро, $0, эфемерно — машина должна быть онлайн):
```bash
cloudflared tunnel --url http://localhost:8090
# выдаёт https://<random>.trycloudflare.com → отдать клиенту
```
**B. VPS / Oracle Always-Free VM** (постоянный): развернуть стек на VM, host-nginx + Let's Encrypt (certbot) терминирует TLS и проксирует на :8090. Обновить `CORS_ORIGINS` в `.env` на домен (для same-origin не критично, но чисто).
**C. On-prem сервер клиента**: тот же compose внутри периметра; для offline — `docker-compose.onprem.yml` (self-host bge-m3 + gpt-oss), данные не покидают сеть.

## 5. Бэкап / восстановление БД
```bash
bash scripts/backup-db.sh            # дамп → backups/ragcms-<ts>.sql.gz (хранит 7)
# restore:
gunzip -c backups/ragcms-<ts>.sql.gz | docker exec -i ragcms-postgres psql -U ragcms ragcms
```
Qdrant-векторы переживают рестарт (volume `qdrant_data`). После restore БД при необходимости реиндексировать (`/index`) — embedding-кэш делает это бесплатным.

## 6. Эксплуатация
- Рестарт переживается: `restart: unless-stopped` на всех контейнерах.
- Логи: `docker logs ragcms-backend` (LOG_LEVEL=INFO, видно hit-rate кэша, провайдеры).
- Остановить туннель: Ctrl+C процесса cloudflared (URL сразу мёртв).

## Security-чеклист (выполнено 2026-06-16)
- [x] JWT startup-guard (≥32 симв.)
- [x] /docs /redoc /openapi off (EXPOSE_DOCS=false)
- [x] rate-limit login 10/min/IP
- [x] nginx security headers (CSP/HSTS/X-Frame/nosniff/Referrer/Permissions)
- [x] регистрация закрыта, tenant-изоляция, bcrypt, path-traversal-safe (Shield-аудит)
- [ ] (опц.) ротация ключей перед on-prem-передачей клиенту
- [ ] (опц.) rate-limit на остальные API при долгой публичной экспозиции
