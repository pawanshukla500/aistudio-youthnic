from routes.dna import router as dna_router
from routes.generation import router as generation_router
from routes.qa import router as qa_router
from routes.memory import router as memory_router
from routes.health import router as health_router
from routes.workflows import router as workflow_router

__all__ = [
    "dna_router",
    "generation_router",
    "qa_router",
    "memory_router",
    "health_router",
    "workflow_router",
]
