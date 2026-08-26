# 2026 Summer Project

2026 Summer Project is a simple Phase 1 classroom response prototype built with Flask, SQLite, HTML, CSS, and JavaScript.

## Folder structure

```text
2026-summer-project/
├── app.py
├── microcheck.db               # created automatically on first run
├── requirements.txt
├── README.md
├── templates/
│   ├── base.html
│   ├── dashboard.html
│   ├── session_create.html
│   ├── session_detail.html
│   └── student.html
└── static/
    ├── css/
    │   └── style.css
    └── js/
      ├── dashboard.js
      ├── session-create.js
      ├── session-detail.js
        └── student.js
```

## How it works

- The instructor opens the dashboard at `/` and goes to the dedicated session creation page.
- The backend generates a random 6-character session code and saves it in SQLite.
- The instructor opens the session page and adds one or more questions inside that session.
- The student opens `/student`, enters the session code and student ID, loads the latest question, and submits an answer with justification.
- Submissions are stored in the `responses` table.
- The session page fetches all questions and responses for the active session and shows them in live tables.

## Instructor Access

- `Amna`, `Thangaval`, and `Hermela` are admin instructors.
- Admin instructors can view every session, question, and response on the admin dashboard.
- Any other instructor ID can still sign in, but they can only open and manage the sessions they created.

## APIs

- `POST /api/sessions` creates a session.
- `GET /api/sessions/<session_code>` returns session metadata and the latest question.
- `GET /api/sessions/<session_code>/questions` returns all questions in the session.
- `POST /api/sessions/<session_code>/questions` adds a question to the session.
- `POST /api/responses` submits a student response.
- `GET /api/sessions/<session_code>/responses` returns all responses for that session.

## Run in VS Code

1. Open the project folder in VS Code.
2. Create a virtual environment:
   - Windows PowerShell: `python -m venv .venv`
3. Activate it:
   - Windows PowerShell: `.venv\Scripts\Activate.ps1`
4. Install dependencies:
   - `pip install -r requirements.txt`
5. Start the app:
   - `python app.py`
6. Open your browser:
   - Instructor dashboard: `http://127.0.0.1:5000/`
   - Create session page: `http://127.0.0.1:5000/instructor/sessions/new`
   - Student page: `http://127.0.0.1:5000/student`

## Notes

- The database file `microcheck.db` is created automatically in the project root.
- AI question generation and misconception detection use a private local Ollama service.
- The default model is `llama3.2:1b`; set `OLLAMA_HOST`, `OLLAMA_MODEL`, and optionally `OLLAMA_TIMEOUT` to configure it.
- Start Ollama separately and run `ollama pull llama3.2:1b` before using AI features. Student data is sent to the configured Ollama host only.

## Permanent Deployment

This project is ready to deploy on Render with a persistent disk for SQLite.

### Important settings

- `MICROCHECK_DB_PATH` should point to `/var/data/microcheck.db` on Render.
- `MICROCHECK_SECRET_KEY` should be set to a strong secret in production.
- The app starts with `gunicorn app:app`.

### Render flow

1. Push the repo to GitHub.
2. Create a new Web Service on Render and connect the repo.
3. Use the included `render.yaml` or set the same values manually.
4. Add the persistent disk so the SQLite database survives restarts.
