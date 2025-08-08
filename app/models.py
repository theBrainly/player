from typing import List, Optional
from pydantic import BaseModel, Field


class Employee(BaseModel):
    id: int
    name: str
    skills: List[str]
    experience_years: int = Field(ge=0)
    projects: List[str] = Field(default_factory=list)
    availability: str = Field(pattern=r"^(available|unavailable|soon|on_leave)$")


class SearchFilters(BaseModel):
    query: Optional[str] = None
    min_experience: Optional[int] = None
    skills: Optional[List[str]] = None
    availability: Optional[str] = None


class SearchResult(BaseModel):
    employee: Employee
    score: float
    matched_skills: List[str] = Field(default_factory=list)


class SearchResponse(BaseModel):
    results: List[SearchResult]


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    answer: str
    top_candidates: List[SearchResult]


class ServiceState(BaseModel):
    employees: List[Employee] = Field(default_factory=list)
    skill_vocabulary: List[str] = Field(default_factory=list)
    # Embedding model and index are stored dynamically (not validated by Pydantic)
    embedder_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    top_k: int = 8