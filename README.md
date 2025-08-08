# HR Resource Query Chatbot

## Overview
An intelligent HR assistant chatbot that answers natural-language resource allocation queries. It uses a lightweight RAG pipeline: semantic retrieval over employee profiles (SentenceTransformers embeddings + cosine similarity) and template/OpenAI-based generation for responses.

## Features
- Semantic search over employee profiles (skills, years, projects, availability)
- Natural-language chat endpoint with query parsing (skills, years, availability)
- REST API with FastAPI: `POST /chat`, `GET /employees/search`
- Streamlit frontend chat UI
- Optional OpenAI generation (falls back to template if not configured)

## Architecture
- Data: JSON dataset (`app/data/employees.json`)
- Embeddings: `sentence-transformers/all-MiniLM-L6-v2`
- Vector search: cosine similarity with scikit-learn
- RAG: retrieve top candidates → augment with context → generate response
- Backend: FastAPI (`app/main.py`)
- Frontend: Streamlit (`frontend/streamlit_app.py`)

## Setup & Installation
1. Python 3.10+
2. Install dependencies:
   ```bash
   pip install -r /workspace/requirements.txt
   ```
3. (Optional) Enable OpenAI generation:
   ```bash
   export OPENAI_API_KEY=YOUR_KEY
   export USE_OPENAI=true
   # optionally choose model
   export OPENAI_MODEL=gpt-4o-mini
   ```
4. Run the backend:
   ```bash
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
5. Open API docs at `http://localhost:8000/docs`.
6. Run the Streamlit UI in a separate terminal:
   ```bash
   streamlit run /workspace/frontend/streamlit_app.py
   ```

## API Documentation
- `GET /employees/search`
  - Query params: `query`, `skills` (comma-separated), `min_experience`, `availability`, `top_k`
  - Returns: ranked employees with scores and matched skills
- `POST /chat`
  - Body: `{ "message": "Find Python developers with 3+ years experience" }`
  - Returns: natural response + top candidates

## AI Development Process
- Assistants used: Cursor (primary), ChatGPT (planning), minimal manual coding
- AI helped generate scaffolding, models, and RAG logic. ~70% AI-assisted, 30% hand-written/refined.
- Interesting bits: hybrid parsing (regex for years, vocab-matching for skills), semantic rerank with skill-boost.
- Challenges: Keeping dependencies lightweight; added a clean fallback when OpenAI is not configured.

## Technical Decisions
- Chose SentenceTransformers local embeddings for privacy and zero-cost inference.
- Avoided FAISS to reduce binary deps; used scikit-learn cosine similarity which is sufficient for small datasets.
- Optional OpenAI for better generation quality while keeping a deterministic template fallback.

## Future Improvements
- More robust NL parsing (spacy/llm-based) for constraints and domains
- Persistent vector index and dataset editing endpoints
- Richer availability/calendar integration
- Feedback loop for relevance and active learning

## Demo
- Run locally following the setup above. Screenshots can be added after first run.
