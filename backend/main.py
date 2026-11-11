import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import get_pool
from cache import get_valkey
from routes import dna_router, generation_router, qa_router, memory_router, health_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("youthnic-studio-orchestrator")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Youthnic AI Studio Orchestration Backend...")
    try:
        pool = get_pool()
        logger.info("PostgreSQL connection pool initialized.")
    except Exception as e:
        logger.error(f"Failed to initialize PostgreSQL pool: {e}")

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
    description="Agentic Multi-Agent AI Fashion Photography Orchestrator with Product DNA V2 and CV QA",
    lifespan=lifespan,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API Routers
app.include_router(health_router)
app.include_router(dna_router)
app.include_router(generation_router)
app.include_router(qa_router)
app.include_router(memory_router)


@app.get("/")
async def root():
    return {
        "service": "Youthnic AI Fashion Studio Orchestration API",
        "version": "2.0.0",
        "status": "online",
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.PORT, reload=False)
