from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes_graph import router as graph_router
from api.routes_positions import router as pos_router
from api.routes_topology import router as topo_router
from api.routes_fibers import router as fibers_router

from core.config import settings

app = FastAPI(title="AUTIN Backbone API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.CORS_ORIGINS] or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(graph_router)
app.include_router(pos_router)
app.include_router(topo_router)
app.include_router(fibers_router)

# Health
from core.db import get_engine
from sqlalchemy import text


@app.get("/health/db")
def health_db():
    eng = get_engine()
    with eng.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True}
