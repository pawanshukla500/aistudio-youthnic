import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import get_pool
from cache import get_valkey
from graph import get_postgres_checkpointer
from routes import (
    dna_router,
    generation_router,
    qa_router,
    memory_router,
    health_router,
    workflow_router,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("youthnic-studio-orchestrator")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Youthnic AI Studio Orchestration Backend...")
    try:
        get_pool()
        logger.info("PostgreSQL connection pool initialized.")
        get_postgres_checkpointer()
        logger.info("LangGraph PostgresSaver checkpointer verified.")
    except Exception as e:
        logger.error(f"Failed to initialize PostgreSQL pool/checkpointer: {e}")

    try:
        r = get_valkey()
        r.ping()
        logger.info("Valkey connection verified.")
    except Exception as e:
        logger.error(f"Failed to connect to Valkey: {e}")

    yield

    logger.info("Shutting down Youthnic AI Studio Orchestrator...")
    try:
        pool = get_pool()
        pool.close()
    except Exception:
        pass


app = FastAPI(
    title="Youthnic AI Fashion Studio Orchestrator",
    version="2.0.0",
    description="Agentic Multi-Agent AI Fashion Photography Orchestrator with Product DNA V2, LangGraph Postgres Checkpointing, and CV QA",
    lifespan=lifespan,
)

cors_origins = [o.strip() for o in (settings.CORS_ORIGINS or "*").split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=(cors_origins != ["*"]),
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(dna_router)
app.include_router(generation_router)
app.include_router(qa_router)
app.include_router(memory_router)
app.include_router(workflow_router)


@app.get("/")
async def root():
    return {
        "service": "Youthnic AI Fashion Studio Orchestration API",
        "version": "2.0.0",
        "status": "online",
        "engines": ["langgraph", "langchain", "celery", "pgvector", "valkey"],
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=False)
