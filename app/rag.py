import os
import re
from typing import Dict, List, Tuple

import numpy as np
from sentence_transformers import SentenceTransformer

from .models import Employee, SearchFilters, SearchResult, ServiceState


YEARS_REGEX = re.compile(r"(\d+)\s*\+?\s*(?:years?|yrs?)", re.IGNORECASE)
AVAIL_TERMS = {"available", "unavailable", "soon", "on_leave"}


def normalize_text(text: str) -> str:
    return " ".join(text.strip().split())


def employee_to_doc(employee: Employee) -> str:
    skills = ", ".join(employee.skills)
    projects = "; ".join(employee.projects)
    return normalize_text(
        f"Name: {employee.name}. Skills: {skills}. Experience: {employee.experience_years} years. "
        f"Projects: {projects}. Availability: {employee.availability}."
    )


class RAGEngine:
    def __init__(self, state: ServiceState):
        self.state = state
        self.embedder = SentenceTransformer(state.embedder_name)
        self.employee_docs: List[str] = []
        self.employee_embeddings: np.ndarray | None = None

    def build(self, employees: List[Employee]) -> None:
        self.state.employees = employees
        # Derive skills vocabulary
        skills = set()
        for e in employees:
            for s in e.skills:
                skills.add(s.lower())
        self.state.skill_vocabulary = sorted(skills)
        # Build documents and embeddings
        self.employee_docs = [employee_to_doc(e) for e in employees]
        self.employee_embeddings = self.embedder.encode(self.employee_docs, normalize_embeddings=True)

    def parse_query(self, query: str) -> Dict:
        query_lower = query.lower()
        min_years = None
        m = YEARS_REGEX.search(query_lower)
        if m:
            try:
                min_years = int(m.group(1))
            except Exception:
                min_years = None
        # Extract skills by vocabulary matching
        mentioned_skills = []
        for skill in self.state.skill_vocabulary:
            # whole word-ish match
            pattern = re.compile(rf"(?<![\w\+]){re.escape(skill)}(?![\w\+])", re.IGNORECASE)
            if pattern.search(query_lower):
                mentioned_skills.append(skill)
        # Availability
        availability = None
        for term in AVAIL_TERMS:
            if term in query_lower:
                availability = term
                break
        return {
            "min_experience": min_years,
            "skills": mentioned_skills,
            "availability": availability,
        }

    def _semantic_scores(self, query: str) -> np.ndarray:
        q_emb = self.embedder.encode([query], normalize_embeddings=True)[0]
        # cosine distance to similarity
        # If index exists, we can use kneighbors to get candidates
        sims = (self.employee_embeddings @ q_emb)
        return sims

    def search(self, filters: SearchFilters, top_k: int = 8) -> List[SearchResult]:
        if self.employee_embeddings is None:
            return []
        query = filters.query or ""
        semantic_scores = self._semantic_scores(query) if query else np.zeros(len(self.state.employees))
        results: List[Tuple[int, float, List[str]]] = []
        skills_lower = set([s.lower() for s in (filters.skills or [])])
        for idx, emp in enumerate(self.state.employees):
            # Hard filters
            if filters.min_experience is not None and emp.experience_years < filters.min_experience:
                continue
            if filters.availability is not None and emp.availability.lower() != filters.availability.lower():
                continue
            # Skill matching: require all requested skills, if any
            emp_skills_lower = {s.lower() for s in emp.skills}
            if skills_lower and not skills_lower.issubset(emp_skills_lower):
                continue
            matched = sorted(list(emp_skills_lower.intersection(skills_lower))) if skills_lower else []
            score = float(semantic_scores[idx])
            # Slightly boost score by number of matched skills
            score += 0.05 * len(matched)
            results.append((idx, score, matched))
        # If no hard-filtered results, fall back to top semantic
        if not results:
            top_indices = np.argsort(-semantic_scores)[:top_k]
            for idx in top_indices:
                results.append((int(idx), float(semantic_scores[int(idx)]), []))
        # Sort by score desc
        results.sort(key=lambda x: x[1], reverse=True)
        final: List[SearchResult] = []
        for idx, score, matched in results[:top_k]:
            final.append(
                SearchResult(employee=self.state.employees[idx], score=round(score, 4), matched_skills=matched)
            )
        return final

    def generate_answer(self, user_query: str, candidates: List[SearchResult]) -> str:
        if not candidates:
            return "I could not find matching employees. Try adjusting skills or experience requirements."
        # Optional OpenAI generation if available
        api_key = os.environ.get("OPENAI_API_KEY")
        use_openai = os.environ.get("USE_OPENAI", "false").lower() in {"1", "true", "yes"}
        if api_key and use_openai:
            try:
                from openai import OpenAI
                client = OpenAI(api_key=api_key)
                bullet_points = "\n".join(
                    [
                        f"- {r.employee.name}: {r.employee.experience_years} yrs; skills: {', '.join(r.employee.skills)}; projects: {', '.join(r.employee.projects)}; availability: {r.employee.availability}"
                        for r in candidates[:6]
                    ]
                )
                system = (
                    "You are an HR assistant. Recommend candidates based on the user's query. "
                    "Be concise but specific. Prefer candidates whose skills and domain match."
                )
                prompt = (
                    f"User query: {user_query}\n\nCandidates:\n{bullet_points}\n\n"
                    "Write a helpful recommendation summarizing the best 2-3 candidates and why, then list any other suitable options briefly."
                )
                resp = client.chat.completions.create(
                    model=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                    temperature=0.3,
                )
                return resp.choices[0].message.content.strip()
            except Exception:
                pass
        # Template-based generation
        lines = [
            "Here are recommended candidates based on your requirements:",
        ]
        for r in candidates[:3]:
            emp = r.employee
            highlights = []
            if r.matched_skills:
                highlights.append(f"matches skills: {', '.join(sorted(set(r.matched_skills)))}")
            highlights.append(f"experience: {emp.experience_years} years")
            highlights.append(f"availability: {emp.availability}")
            lines.append(
                f"- {emp.name} — {', '.join(emp.skills)}. Projects: {', '.join(emp.projects)}. (" + "; ".join(highlights) + ")"
            )
        if len(candidates) > 3:
            others = ", ".join([c.employee.name for c in candidates[3:6]])
            if others:
                lines.append(f"Other suitable options: {others}.")
        lines.append("Tell me if you'd like me to check availability or share contact details.")
        return "\n".join(lines)