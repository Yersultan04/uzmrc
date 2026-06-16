import logging
import os
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select

from app.api import agent, auth, compare, files, ingest, rags, search
from app.auth import hash_password
from app.config import get_settings
from app.db import SessionLocal, engine
from app.models import User, UserRole

# App loggers ("ingestion", "startup", ...) have no handler of their own —
# uvicorn only configures its own loggers, leaving the root untouched. Configure
# the root logger so our INFO logs (e.g. embed-cache hit rates) reach stdout.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

log = logging.getLogger("startup")

settings = get_settings()


async def _bootstrap_admin_from_env() -> None:
    s = get_settings()
    if not s.bootstrap_admin_email or not s.bootstrap_admin_password:
        return
    async with SessionLocal() as db:
        existing = (await db.execute(select(func.count(User.id)))).scalar_one()
        if existing > 0:
            return
        user = User(
            id=uuid.uuid4(),
            email=s.bootstrap_admin_email.lower().strip(),
            password_hash=hash_password(s.bootstrap_admin_password),
            role=UserRole.admin,
        )
        db.add(user)
        await db.commit()
        log.info("bootstrap admin created from env: %s", user.email)


_DEFAULT_JWT_SECRET = "change-me-to-a-long-random-string"


def _assert_secure_config() -> None:
    """Fail fast on insecure config before serving any request.

    A missing/leftover-default JWT secret would silently sign tokens with a known
    public string — anyone could forge an admin JWT. Refuse to start instead.
    """
    s = settings
    if s.jwt_secret == _DEFAULT_JWT_SECRET or len(s.jwt_secret) < 32:
        raise RuntimeError(
            "JWT_SECRET is unset, default, or too short (<32 chars). Set a strong "
            "JWT_SECRET in the environment before starting. Generate one with: "
            'python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is managed by Alembic (`alembic upgrade head`). Do not create_all here —
    # silent table creation diverges from migration history and bites on the first ALTER.
    _assert_secure_config()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    try:
        await _bootstrap_admin_from_env()
    except Exception as e:
        log.warning("bootstrap admin failed (skipping): %s", e)
    yield
    await engine.dispose()


# Interactive API docs (/docs, /redoc) leak the full API surface — keep them off
# for a public demo. Set EXPOSE_DOCS=true to re-enable locally.
_docs_on = os.getenv("EXPOSE_DOCS", "false").lower() == "true"

app = FastAPI(
    title="rag-cms",
    description="Multi-tenant agentic RAG platform",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if _docs_on else None,
    redoc_url="/redoc" if _docs_on else None,
    openapi_url="/openapi.json" if _docs_on else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(rags.router, prefix="/api/rags", tags=["rags"])
app.include_router(files.router, prefix="/api/rags", tags=["files"])
app.include_router(ingest.router, prefix="/api/rags", tags=["ingest"])
app.include_router(search.router, prefix="/api/rags", tags=["search"])
app.include_router(agent.router, prefix="/api/rags", tags=["agent"])
app.include_router(compare.router, prefix="/api/rags", tags=["compare"])
