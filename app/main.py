import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .models import ChatRequest, ChatResponse, Employee, SearchFilters, SearchResponse, ServiceState
from .rag import RAGEngine

APP_DIR = Path(__file__).parent
DATA_FILE = APP_DIR / "data" / "employees.json"

app = FastAPI(title="HR Resource Query Chatbot", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

state = ServiceState()
engine: Optional[RAGEngine] = None


@app.on_event("startup")
async def startup_event():
    global engine
    if not DATA_FILE.exists():
        raise RuntimeError(f"Missing data file: {DATA_FILE}")
    employees_raw = json.loads(DATA_FILE.read_text())
    employees: List[Employee] = [Employee(**e) for e in employees_raw["employees"]]
    engine = RAGEngine(state)
    engine.build(employees)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/employees/search", response_model=SearchResponse)
async def search_employees(
    query: Optional[str] = Query(default=None, description="Free-text query"),
    skills: Optional[str] = Query(default=None, description="Comma-separated skills"),
    min_experience: Optional[int] = Query(default=None, ge=0),
    availability: Optional[str] = Query(default=None, description="available|unavailable|soon|on_leave"),
    top_k: int = Query(default=8, ge=1, le=50),
):
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not ready")
    skills_list = [s.strip() for s in skills.split(",")] if skills else None
    filters = SearchFilters(
        query=query,
        min_experience=min_experience,
        skills=skills_list,
        availability=availability,
    )
    results = engine.search(filters, top_k=top_k)
    return SearchResponse(results=results)


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if engine is None:
        raise HTTPException(status_code=503, detail="Engine not ready")
    # Parse query into filters
    parsed = engine.parse_query(req.message)
    filters = SearchFilters(query=req.message, **parsed)
    results = engine.search(filters, top_k=8)
    answer = engine.generate_answer(req.message, results)
    return ChatResponse(answer=answer, top_candidates=results)