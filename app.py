from __future__ import annotations

import json
import os
import secrets
import sqlite3
import re
import importlib
import urllib.error
import urllib.request
from io import BytesIO
from datetime import datetime, timezone
from pathlib import Path

from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
except ImportError:
    pass

DB_PATH = Path(os.environ.get("MICROCHECK_DB_PATH", str(BASE_DIR / "microcheck.db")))

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
app.secret_key = os.environ.get("MICROCHECK_SECRET_KEY", "dev-microcheck-secret-key")


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if request.path.startswith("/api/"):
        print(f"API error on {request.path}: {error}")
        return jsonify({"error": "The server could not complete that request. Check the Render logs for details."}), 500
    raise error

# Initialize the private local Ollama model for misconception detection
try:
    from ollama_runner import OllamaRunner
    slm = OllamaRunner()
    print(f"✓ Private Ollama model initialized: {slm.model}")
except Exception as e:
    print(f"⚠ Warning: Could not initialize private Ollama model: {e}")
    slm = None

# Initialize Gemini configuration without loading an SDK into the Render worker.
gemini_api_key = os.environ.get("GEMINI_API_KEY")
gemini_model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
gemini_client = bool(gemini_api_key)
if gemini_client:
    print("✓ Gemini configured for question generation")
else:
    print("⚠ Warning: GEMINI_API_KEY not set")

ADMIN_INSTRUCTOR_IDS = {"AMNA", "THANGAVAL", "HERMELA"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db() -> None:
    with get_db() as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_code TEXT NOT NULL UNIQUE,
                question TEXT NOT NULL,
                creator_id TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS session_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_code TEXT NOT NULL,
                question_text TEXT NOT NULL,
                question_type TEXT NOT NULL DEFAULT 'open_ended',
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_code) REFERENCES sessions(session_code) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS session_question_options (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question_id INTEGER NOT NULL,
                option_text TEXT NOT NULL,
                option_order INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (question_id) REFERENCES session_questions(id) ON DELETE CASCADE
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS responses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_code TEXT NOT NULL,
                question_id INTEGER,
                student_id TEXT NOT NULL,
                answer TEXT NOT NULL,
                justification TEXT NOT NULL,
                submitted_at TEXT NOT NULL,
                FOREIGN KEY (session_code) REFERENCES sessions(session_code) ON DELETE CASCADE
            )
            """
        )

        response_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(responses)").fetchall()
        }
        if "question_id" not in response_columns:
            db.execute("ALTER TABLE responses ADD COLUMN question_id INTEGER")

        session_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if "creator_id" not in session_columns:
            db.execute("ALTER TABLE sessions ADD COLUMN creator_id TEXT")

        question_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(session_questions)").fetchall()
        }
        if "question_type" not in question_columns:
            db.execute(
                "ALTER TABLE session_questions ADD COLUMN question_type TEXT NOT NULL DEFAULT 'open_ended'"
            )

        # Create table for misconception catalog
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS misconceptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                severity TEXT DEFAULT 'MEDIUM',
                created_at TEXT NOT NULL
            )
            """
        )

        # Create table for professor resources associated with misconceptions
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS professor_resources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                misconception_id INTEGER NOT NULL,
                resource_text TEXT,
                resource_url TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (misconception_id) REFERENCES misconceptions(id) ON DELETE CASCADE
            )
            """
        )

        # Create table to track student misconceptions
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS student_misconceptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                response_id INTEGER NOT NULL,
                student_id TEXT NOT NULL,
                question_id INTEGER,
                misconception_code TEXT,
                confidence_score REAL,
                severity TEXT,
                feedback_text TEXT,
                detected_at TEXT NOT NULL,
                FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE
            )
            """
        )

        # Add answer_key column to session_questions if it doesn't exist
        question_columns = {
            row[1]
            for row in db.execute("PRAGMA table_info(session_questions)").fetchall()
        }
        if "answer_key" not in question_columns:
            db.execute("ALTER TABLE session_questions ADD COLUMN answer_key TEXT")


def parse_question_options(payload) -> list[str]:
    raw_options = payload.get("options") or []
    if not isinstance(raw_options, list):
        return []

    options = [str(option).strip() for option in raw_options]
    return [option for option in options if option]


def extract_text_from_upload(uploaded_file) -> str:
    filename = (uploaded_file.filename or "").lower()
    raw_bytes = uploaded_file.read()

    if not raw_bytes:
        return ""

    if filename.endswith(('.pdf',)):
        try:
            PdfReader = importlib.import_module('pypdf').PdfReader
        except ImportError:
            return raw_bytes.decode('utf-8', errors='ignore')

        reader = PdfReader(BytesIO(raw_bytes))
        return "\n".join((page.extract_text() or "") for page in reader.pages)

    if filename.endswith(('.pptx', '.ppt')):
        try:
            Presentation = importlib.import_module('pptx').Presentation
        except ImportError:
            return raw_bytes.decode('utf-8', errors='ignore')

        presentation = Presentation(BytesIO(raw_bytes))
        slide_text = []
        for slide in presentation.slides:
            for shape in slide.shapes:
                if hasattr(shape, 'text') and shape.text:
                    slide_text.append(shape.text)
        return "\n".join(slide_text)

    if filename.endswith(('.docx',)):
        try:
            Document = importlib.import_module('docx').Document
        except ImportError:
            return raw_bytes.decode('utf-8', errors='ignore')

        document = Document(BytesIO(raw_bytes))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)

    if filename.endswith(('.html', '.htm')):
        text = raw_bytes.decode('utf-8', errors='ignore')
        text = re.sub(r'<script.*?</script>', ' ', text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<style.*?</style>', ' ', text, flags=re.IGNORECASE | re.DOTALL)
        return re.sub(r'<[^>]+>', ' ', text)

    try:
        return raw_bytes.decode('utf-8')
    except UnicodeDecodeError:
        return raw_bytes.decode('latin-1', errors='ignore')


def normalize_uploaded_text(text: str) -> str:
    """Pass through text with minimal processing."""
    lines = [re.sub(r'\s+', ' ', line).strip() for line in text.splitlines() if line.strip()]
    return "\n".join(lines)


def summarize_snippet(text: str, limit: int = 90) -> str:
    cleaned = re.sub(r'\s+', ' ', text).strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rsplit(' ', 1)[0].rstrip(' ,;:-')


def to_concept_prompt(text: str, max_concepts: int = 12) -> str:
    normalized_text = normalize_uploaded_text(text)
    if not normalized_text:
        normalized_text = re.sub(r'\s+', ' ', text).strip()

    paragraphs = [
        re.sub(r'\s+', ' ', chunk).strip()
        for chunk in re.split(r'\n{2,}|\r\n{2,}', normalized_text)
        if chunk.strip()
    ]

    concepts = []
    seen = set()
    for paragraph in paragraphs:
        snippet = summarize_snippet(paragraph, limit=120)
        if not snippet:
            continue

        concept = snippet
        lower_concept = concept.lower()
        if lower_concept in seen:
            continue
        seen.add(lower_concept)
        concepts.append(concept)
        if len(concepts) >= max_concepts:
            break

    if not concepts and normalized_text:
        concepts.append(summarize_snippet(normalized_text, limit=120) or "Key ideas in the uploaded material")

    return "\n- ".join(concepts)


def generate_questions_from_text(text: str, max_questions: int = 20) -> list[str]:
    text = normalize_uploaded_text(text) or text
    paragraphs = [
        re.sub(r'\s+', ' ', chunk).strip()
        for chunk in re.split(r'\n{2,}|\r\n{2,}', text)
        if chunk.strip()
    ]

    sentences = [
        re.sub(r'\s+', ' ', sentence).strip()
        for sentence in re.split(r'(?<=[.!?])\s+', text)
        if len(sentence.strip()) > 40
    ]

    candidates = []

    for paragraph in paragraphs:
        snippet = summarize_snippet(paragraph)
        if snippet:
            candidates.append(f'What conclusion can be logically drawn from this section, and which detail best supports it: {snippet}?')

    for sentence in sentences:
        snippet = summarize_snippet(sentence)
        if snippet:
            candidates.append(f'If the situation described here changed, what outcome would you predict and why: {snippet}?')

    unique_questions = []
    seen = set()
    for question in candidates:
        normalized = question.lower()
        if normalized not in seen:
            seen.add(normalized)
            unique_questions.append(question)
        if len(unique_questions) >= max_questions:
            break

    if not unique_questions and text.strip():
        unique_questions.append('What claim does the material support, what evidence supports it, and what assumption connects the evidence to the claim?')

    return unique_questions


def extract_concepts_from_text(text: str, max_concepts: int = 12) -> list[str]:
    prompt = to_concept_prompt(text, max_concepts=max_concepts)
    if not prompt:
        return []

    return [line.strip("- ") for line in prompt.splitlines() if line.strip()]


def strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def normalize_generated_questions(items, max_questions: int) -> list[dict]:
    normalized_questions = []

    for item in items or []:
        if not isinstance(item, dict):
            continue

        question_type = normalize_question_type(item.get("question_type"))
        question_text = str(item.get("question_text") or item.get("question") or "").strip()
        if not question_text:
            continue

        if question_type == "mcq":
            options = parse_question_options(item)
            if len(options) < 2:
                continue
            normalized_questions.append(
                {
                    "question_text": question_text,
                    "question_type": "mcq",
                    "options": options[:4],
                }
            )
        else:
            normalized_questions.append(
                {
                    "question_text": question_text,
                    "question_type": "open_ended",
                    "options": [],
                }
            )

        if len(normalized_questions) >= max_questions:
            break

    return normalized_questions


def generate_questions_with_ai(text: str, max_questions: int = 10) -> list[dict] | tuple[None, str]:
    """Simple Gemini question generation - MCQs and open-ended."""
    if not gemini_client:
        return None, "Gemini API is not configured or available. Please set GEMINI_API_KEY."

    prompt = f"""Generate test questions from the provided lecture material.
Return ONLY valid JSON - nothing else.
Format: {{"questions":[{{"question_type":"mcq","question_text":"...","options":["A","B","C","D"]}},{{"question_type":"open_ended","question_text":"...","options":[]}}]}}

Requirements:
- Mix MCQ and open-ended questions (roughly half each)
- Use ONLY information from the lecture material
- MCQ: 4 options, 1 clearly correct answer, 3 plausible distractors
- Open-ended: Ask for explanation or reasoning
- Keep questions concise and clear
- Make each question different
- No trick questions, no ambiguous answers

Generate exactly {max_questions} questions from this material:

{text[:20000]}"""

    try:
        payload = json.dumps({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.7,
                "responseMimeType": "application/json",
            },
        }).encode("utf-8")
        models_to_try = list(dict.fromkeys([
            gemini_model,
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
        ]))
        result = None
        last_not_found = None
        for model_name in models_to_try:
            request = urllib.request.Request(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={gemini_api_key}",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    result = json.loads(response.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as error:
                if error.code != 404:
                    raise
                last_not_found = error

        if result is None:
            raise RuntimeError(f"No configured Gemini model was found: {last_not_found}")

        response_text = result["candidates"][0]["content"]["parts"][0]["text"].strip()
        question_parsed = json.loads(response_text)
        
    except json.JSONDecodeError as e:
        # Try to extract JSON if wrapped in text
        try:
            import re as re_module
            json_match = re_module.search(r'\{.*\}', response_text, re_module.DOTALL)
            if json_match:
                question_parsed = json.loads(json_match.group(0))
            else:
                return None, f"Gemini returned invalid JSON: {str(e)}"
        except Exception as parse_error:
            return None, f"Failed to parse Gemini response: {parse_error}"
    except Exception as error:
        return None, f"Gemini API error: {error}"

    generated_questions = normalize_generated_questions(question_parsed.get("questions"), max_questions)
    if not generated_questions:
        return None, "Gemini did not return usable questions."

    return generated_questions

    return generated_questions


def generate_session_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(6))


def create_unique_session_code(db: sqlite3.Connection) -> str:
    while True:
        code = generate_session_code()
        exists = db.execute(
            "SELECT 1 FROM sessions WHERE session_code = ?",
            (code,),
        ).fetchone()
        if not exists:
            return code


def current_instructor_id() -> str | None:
    instructor_id = session.get("instructor_id")
    return str(instructor_id).upper() if instructor_id else None


def current_instructor_is_admin() -> bool:
    instructor_id = current_instructor_id()
    return bool(instructor_id and instructor_id in ADMIN_INSTRUCTOR_IDS)


QUESTION_TYPES = {
    "mcq": "Multiple choice",
    "open_ended": "Open ended",
    "short_answer": "Short answer",
}


def normalize_question_type(value) -> str:
    question_type = str(value or "").strip().lower()
    return question_type if question_type in QUESTION_TYPES else "open_ended"


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not current_instructor_id():
            if request.path.startswith("/api/"):
                return jsonify({"error": "Instructor login required."}), 401
            return redirect(url_for("instructor_access_page"))
        return view(*args, **kwargs)

    return wrapped_view


def instructor_session_access_required(view):
    @wraps(view)
    def wrapped_view(session_code: str, *args, **kwargs):
        instructor_id = current_instructor_id()
        if not instructor_id:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Instructor login required."}), 401
            return redirect(url_for("instructor_access_page"))

        with get_db() as db:
            owner = db.execute(
                "SELECT creator_id FROM sessions WHERE session_code = ?",
                (session_code.upper(),),
            ).fetchone()

        if owner is None:
            return jsonify({"error": "Session not found."}), 404

        owner_id = str(owner["creator_id"]).upper() if owner["creator_id"] else None
        if not current_instructor_is_admin() and owner_id != instructor_id:
            return jsonify({"error": "You do not have access to this session."}), 403

        return view(session_code, *args, **kwargs)

    return wrapped_view


init_db()


@app.route("/")
def splash_page():
    initial_session_code = str(request.args.get("session_code", "")).strip().upper()
    return render_template("splash.html", initial_session_code=initial_session_code)


@app.route("/instructor/access")
def instructor_access_page():
    return render_template("instructor_access.html")


@app.post("/instructor/login")
def instructor_login():
    payload = request.get_json(silent=True) or {}
    instructor_id = str(payload.get("instructor_id", "")).strip().upper()

    if not instructor_id:
        return jsonify({"error": "Instructor ID is required."}), 400

    session["instructor_id"] = instructor_id
    session["is_admin"] = instructor_id in ADMIN_INSTRUCTOR_IDS

    return jsonify(
        {
            "instructor_id": instructor_id,
            "is_admin": session["is_admin"],
            "redirect_url": "/instructor/admin" if session["is_admin"] else "/instructor/sessions/new",
        }
    )


@app.get("/instructor/logout")
def instructor_logout():
    session.pop("instructor_id", None)
    session.pop("is_admin", None)
    return redirect(url_for("splash_page"))


@app.route("/instructor/portal")
@login_required
def instructor_portal_page():
    return render_template("instructor_portal.html")


@app.route("/instructor/sessions/new")
@login_required
def create_session_page():
    return render_template("session_create.html")


@app.route("/instructor/sessions/<session_code>")
@login_required
def session_detail_page(session_code: str):
    instructor_id = current_instructor_id()

    with get_db() as db:
        owner = db.execute(
            "SELECT creator_id FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

    if owner is None:
        return jsonify({"error": "Session not found."}), 404

    owner_id = str(owner["creator_id"]).upper() if owner["creator_id"] else None
    if not current_instructor_is_admin() and owner_id != instructor_id:
        return redirect(url_for("create_session_page"))

    return render_template("session_detail.html", session_code=session_code.upper())


@app.route("/student")
def student_page():
    initial_session_code = str(request.args.get("session_code", "")).strip().upper()
    return render_template("student.html", initial_session_code=initial_session_code)


@app.route("/instructor/admin")
@login_required
def instructor_admin_page():
    if not current_instructor_is_admin():
        return redirect(url_for("create_session_page"))
    return render_template("instructor_admin.html")


@app.route("/student/done")
def student_done_page():
    return render_template("student_done.html")


@app.post("/api/sessions")
@login_required
def create_session():
    with get_db() as db:
        session_code = create_unique_session_code(db)
        created_at = utc_now()
        db.execute(
            "INSERT INTO sessions (session_code, question, creator_id, created_at) VALUES (?, ?, ?, ?)",
            (session_code, "", current_instructor_id(), created_at),
        )

    return (
        jsonify(
            {
                "session_code": session_code,
                "created_at": created_at,
                "message": "Session created successfully.",
                "session_url": f"/instructor/sessions/{session_code}",
            }
        ),
        201,
    )


@app.get("/api/sessions/<session_code>")
def get_session(session_code: str):
    with get_db() as db:
        session = db.execute(
            "SELECT session_code, created_at FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

        latest_question = db.execute(
            """
            SELECT id, session_code, question_text, question_type, created_at
            FROM session_questions
            WHERE session_code = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (session_code.upper(),),
        ).fetchone()

        question_count = db.execute(
            "SELECT COUNT(*) AS total FROM session_questions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()["total"]

    if session is None:
        return jsonify({"error": "Session not found."}), 404

    return jsonify(
        {
            "session_code": session["session_code"],
            "created_at": session["created_at"],
            "question_count": question_count,
            "latest_question": (
                {
                    "id": latest_question["id"],
                    "session_code": latest_question["session_code"],
                    "question_text": latest_question["question_text"],
                    "question_type": latest_question["question_type"],
                    "created_at": latest_question["created_at"],
                }
                if latest_question is not None
                else None
            ),
        }
    )


@app.get("/api/sessions/<session_code>/questions")
def get_session_questions(session_code: str):
    student_id = str(request.args.get("student_id", "")).strip()

    with get_db() as db:
        session = db.execute(
            "SELECT 1 FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

        if session is None:
            return jsonify({"error": "Session not found."}), 404

        questions = db.execute(
            """
            SELECT
                q.id,
                q.session_code,
                q.question_text,
                q.question_type,
                q.created_at,
                COUNT(r.id) AS response_count
            FROM session_questions AS q
            LEFT JOIN responses AS r ON r.question_id = q.id
            WHERE q.session_code = ?
            GROUP BY q.id, q.session_code, q.question_text, q.created_at
            ORDER BY q.id DESC
            """,
            (session_code.upper(),),
        ).fetchall()

        question_options = {}
        if questions:
            question_ids = [row["id"] for row in questions]
            placeholders = ",".join("?" for _ in question_ids)
            for row in db.execute(
                f"""
                SELECT question_id, option_text, option_order
                FROM session_question_options
                WHERE question_id IN ({placeholders})
                ORDER BY question_id ASC, option_order ASC, id ASC
                """,
                question_ids,
            ).fetchall():
                question_options.setdefault(row["question_id"], []).append(
                    {
                        "option_text": row["option_text"],
                        "option_order": row["option_order"],
                    }
                )

        answered_question_ids = []
        if student_id:
            answered_question_ids = [
                row["question_id"]
                for row in db.execute(
                    """
                    SELECT DISTINCT question_id
                    FROM responses
                    WHERE session_code = ? AND student_id = ?
                    ORDER BY question_id ASC
                    """,
                    (session_code.upper(), student_id),
                ).fetchall()
                if row["question_id"] is not None
            ]

    return jsonify(
        {
            "session_code": session_code.upper(),
            "completed": bool(questions) and len(answered_question_ids) >= len(questions),
            "answered_question_ids": answered_question_ids,
            "questions": [
                {
                    "id": row["id"],
                    "session_code": row["session_code"],
                    "question_text": row["question_text"],
                    "question_type": row["question_type"],
                    "options": question_options.get(row["id"], []),
                    "created_at": row["created_at"],
                    "response_count": row["response_count"],
                }
                for row in questions
            ],
        }
    )


@app.post("/api/sessions/<session_code>/questions")
def create_session_question(session_code: str):
    payload = request.get_json(silent=True) or {}
    question_text = str(payload.get("question_text", "")).strip()
    question_type = normalize_question_type(payload.get("question_type"))
    options = parse_question_options(payload)

    if not question_text:
        return jsonify({"error": "Question text is required."}), 400

    if question_type == "mcq" and len(options) < 2:
        return jsonify({"error": "MCQ questions require at least two answer options."}), 400

    with get_db() as db:
        session = db.execute(
            "SELECT 1 FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

        if session is None:
            return jsonify({"error": "Session not found."}), 404

        created_at = utc_now()
        cursor = db.execute(
            """
            INSERT INTO session_questions (session_code, question_text, question_type, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (session_code.upper(), question_text, question_type, created_at),
        )

        if question_type == "mcq":
            for option_order, option_text in enumerate(options, start=1):
                db.execute(
                    """
                    INSERT INTO session_question_options (question_id, option_text, option_order, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (cursor.lastrowid, option_text, option_order, created_at),
                )

    return (
        jsonify(
            {
                "id": cursor.lastrowid,
                "session_code": session_code.upper(),
                "question_text": question_text,
                "question_type": question_type,
                "options": options if question_type == "mcq" else [],
                "created_at": created_at,
                "message": "Question added successfully.",
            }
        ),
        201,
    )


@app.post("/api/responses")
def submit_response():
    payload = request.get_json(silent=True) or {}
    session_code = str(payload.get("session_code", "")).strip().upper()
    question_id = payload.get("question_id")
    student_id = str(payload.get("student_id", "")).strip()
    answer = str(payload.get("answer", "")).strip()
    justification = str(payload.get("justification", "")).strip()

    if not session_code or not student_id or not answer:
        return jsonify({"error": "Session code, student ID, and answer are required."}), 400

    with get_db() as db:
        session = db.execute(
            "SELECT 1 FROM sessions WHERE session_code = ?",
            (session_code,),
        ).fetchone()

        if session is None:
            return jsonify({"error": "Session not found."}), 404

        question_total = db.execute(
            "SELECT COUNT(*) AS total FROM session_questions WHERE session_code = ?",
            (session_code,),
        ).fetchone()["total"]

        answered_total = db.execute(
            """
            SELECT COUNT(DISTINCT question_id) AS total
            FROM responses
            WHERE session_code = ? AND student_id = ?
            """,
            (session_code, student_id),
        ).fetchone()["total"]

        if question_total and answered_total >= question_total:
            return jsonify({"error": "This session has already been completed for this student ID."}), 403

        if question_id in (None, ""):
            question = db.execute(
                """
                SELECT id
                FROM session_questions
                WHERE session_code = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (session_code,),
            ).fetchone()
            if question is None:
                return jsonify({"error": "Add a question before collecting responses."}), 400
            question_id = question["id"]
        else:
            try:
                question_id = int(question_id)
            except (TypeError, ValueError):
                return jsonify({"error": "Invalid question selected."}), 400

            question = db.execute(
                """
                SELECT id
                FROM session_questions
                WHERE id = ? AND session_code = ?
                """,
                (question_id, session_code),
            ).fetchone()

            if question is None:
                return jsonify({"error": "Question not found for this session."}), 404

            existing_response = db.execute(
                """
                SELECT 1
                FROM responses
                WHERE session_code = ? AND student_id = ? AND question_id = ?
                LIMIT 1
                """,
                (session_code, student_id, question_id),
            ).fetchone()

            if existing_response is not None:
                return jsonify({"error": "You already answered this question."}), 409

        question_type_row = db.execute(
            "SELECT question_type FROM session_questions WHERE id = ?",
            (question_id,),
        ).fetchone()

        question_type = str(question_type_row["question_type"]).strip() if question_type_row else "open_ended"

        if question_type != "mcq" and not justification:
            return jsonify({"error": "Justification is required for this question."}), 400

        if question_type == "mcq":
            justification = ""

        submitted_at = utc_now()
        db.execute(
            """
            INSERT INTO responses (session_code, question_id, student_id, answer, justification, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_code, question_id, student_id, answer, justification, submitted_at),
        )
        db.commit()

        # Get the response ID, question text, and answer key for misconception detection
        response_row = db.execute(
            "SELECT id FROM responses WHERE question_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1",
            (question_id, student_id),
        ).fetchone()
        response_id = response_row["id"] if response_row else None

        question_row = db.execute(
            "SELECT question_text, answer_key FROM session_questions WHERE id = ?",
            (question_id,),
        ).fetchone()
        question_text = question_row["question_text"] if question_row else ""
        answer_key = question_row["answer_key"] if question_row else None

        # Initialize misconception feedback
        misconception_feedback = None
        
        # Run misconception detection if SLM is available
        if slm is not None:
            try:
                # Pass answer key to SLM for better comparison
                misconception_result = slm.predict_misconception(question_text, answer, answer_key=answer_key)
                
                # Store the misconception detection result in database
                db.execute(
                    """
                    INSERT INTO student_misconceptions 
                    (response_id, student_id, question_id, misconception_code, confidence_score, severity, feedback_text, detected_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        response_id,
                        student_id,
                        question_id,
                        misconception_result.get("misconception_code"),
                        misconception_result.get("confidence_score"),
                        misconception_result.get("severity"),
                        misconception_result.get("slm_feedback"),
                        utc_now(),
                    ),
                )
                db.commit()
                misconception_feedback = misconception_result
            except Exception as e:
                print(f"Error during misconception detection: {e}")
                # Continue without misconception feedback if SLM fails

    response_data = {
        "message": "Response submitted successfully.",
        "submitted_at": submitted_at,
        "response_id": response_id,
    }
    
    # Include misconception feedback if available
    if misconception_feedback:
        response_data["misconception"] = misconception_feedback

    return jsonify(response_data), 201


@app.get("/api/sessions/<session_code>/responses")
def get_session_responses(session_code: str):
    with get_db() as db:
        session = db.execute(
            "SELECT session_code, created_at FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

        if session is None:
            return jsonify({"error": "Session not found."}), 404

        responses = db.execute(
            """
            SELECT
                r.id,
                r.student_id,
                r.answer,
                r.justification,
                r.submitted_at,
                r.question_id,
                q.question_type,
                q.question_text,
                sm.misconception_code,
                sm.severity as misconception_severity,
                sm.feedback_text as misconception_feedback
            FROM responses AS r
            LEFT JOIN session_questions AS q ON q.id = r.question_id
            LEFT JOIN student_misconceptions AS sm ON sm.response_id = r.id
            WHERE r.session_code = ?
            ORDER BY r.submitted_at DESC, r.id DESC
            """,
            (session["session_code"],),
        ).fetchall()

        questions = db.execute(
            """
            SELECT
                q.id,
                q.question_text,
                q.created_at,
                COUNT(r.id) AS response_count
            FROM session_questions AS q
            LEFT JOIN responses AS r ON r.question_id = q.id
            WHERE q.session_code = ?
            GROUP BY q.id, q.question_text, q.created_at
            ORDER BY q.id DESC
            """,
            (session["session_code"],),
        ).fetchall()

    return jsonify(
        {
            "session_code": session["session_code"],
            "created_at": session["created_at"],
            "question_count": len(questions),
            "total_responses": len(responses),
            "questions": [
                {
                    "id": row["id"],
                    "question_text": row["question_text"],
                    "created_at": row["created_at"],
                    "response_count": row["response_count"],
                }
                for row in questions
            ],
            "responses": [
                {
                    "student_id": row["student_id"],
                    "answer": row["answer"],
                    "justification": row["justification"],
                    "submitted_at": row["submitted_at"],
                    "question_id": row["question_id"],
                    "question_type": row["question_type"],
                    "question_text": row["question_text"],
                    "misconception_code": row["misconception_code"],
                    "misconception_severity": row["misconception_severity"],
                    "misconception_feedback": row["misconception_feedback"],
                }
                for row in responses
            ],
        }
    )


@app.get("/health")
def health_check():
    return jsonify({"status": "ok"})


@app.get("/api/instructor/sessions/<session_code>")
@instructor_session_access_required
def get_instructor_session(session_code: str):
    return get_session(session_code)


@app.get("/api/instructor/sessions/<session_code>/questions")
@instructor_session_access_required
def get_instructor_session_questions(session_code: str):
    with get_db() as db:
        questions = db.execute(
            """
            SELECT
                q.id,
                q.session_code,
                q.question_text,
                q.question_type,
                q.created_at,
                COUNT(r.id) AS response_count
            FROM session_questions AS q
            LEFT JOIN responses AS r ON r.question_id = q.id
            WHERE q.session_code = ?
            GROUP BY q.id, q.session_code, q.question_text, q.created_at
            ORDER BY q.id DESC
            """,
            (session_code.upper(),),
        ).fetchall()

        question_options = {}
        if questions:
            question_ids = [row["id"] for row in questions]
            placeholders = ",".join("?" for _ in question_ids)
            for row in db.execute(
                f"""
                SELECT question_id, option_text, option_order
                FROM session_question_options
                WHERE question_id IN ({placeholders})
                ORDER BY question_id ASC, option_order ASC, id ASC
                """,
                question_ids,
            ).fetchall():
                question_options.setdefault(row["question_id"], []).append(
                    {
                        "option_text": row["option_text"],
                        "option_order": row["option_order"],
                    }
                )

    return jsonify(
        {
            "session_code": session_code.upper(),
            "questions": [
                {
                    "id": row["id"],
                    "session_code": row["session_code"],
                    "question_text": row["question_text"],
                    "question_type": row["question_type"],
                    "options": question_options.get(row["id"], []),
                    "created_at": row["created_at"],
                    "response_count": row["response_count"],
                }
                for row in questions
            ],
        }
    )


@app.post("/api/instructor/sessions/<session_code>/questions")
@instructor_session_access_required
def create_instructor_session_question(session_code: str):
    return create_session_question(session_code)


@app.post("/api/instructor/sessions/<session_code>/import-questions")
@instructor_session_access_required
def import_questions_from_file(session_code: str):
    uploaded_file = request.files.get("file")
    requested_count_raw = request.form.get("question_count", "10")

    try:
        requested_count = max(1, min(20, int(requested_count_raw)))
    except (TypeError, ValueError):
        requested_count = 10

    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Please upload a text-based file."}), 400

    file_text = extract_text_from_upload(uploaded_file)
    if not file_text.strip():
        return jsonify({"error": "The uploaded file could not be read as text."}), 400

    generated_questions = generate_questions_with_ai(file_text, requested_count)
    generation_source = "Gemini"

    if isinstance(generated_questions, tuple):
        generated_questions, error_message = generated_questions
        if generated_questions is None:
            return jsonify({"error": error_message or "Gemini question generation failed."}), 400

    if not generated_questions:
        return jsonify({"error": "Gemini did not generate usable questions. Try uploading different content."}), 400
        generation_source = "heuristic"

    if not generated_questions:
        return jsonify({"error": "No questions could be generated from the uploaded file."}), 400

    with get_db() as db:
        session_row = db.execute(
            "SELECT 1 FROM sessions WHERE session_code = ?",
            (session_code.upper(),),
        ).fetchone()

        if session_row is None:
            return jsonify({"error": "Session not found."}), 404

        created_at = utc_now()
        inserted_questions = []

        for question in generated_questions:
            cursor = db.execute(
                """
                INSERT INTO session_questions (session_code, question_text, question_type, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (session_code.upper(), question["question_text"], question["question_type"], created_at),
            )
            inserted_questions.append(
                {
                    "id": cursor.lastrowid,
                    "question_text": question["question_text"],
                    "question_type": question["question_type"],
                    "created_at": created_at,
                    "response_count": 0,
                    "options": question.get("options", []),
                }
            )

            if question["question_type"] == "mcq":
                for option_order, option_text in enumerate(question.get("options", []), start=1):
                    db.execute(
                        """
                        INSERT INTO session_question_options (question_id, option_text, option_order, created_at)
                        VALUES (?, ?, ?, ?)
                        """,
                        (cursor.lastrowid, option_text, option_order, created_at),
                    )

    return jsonify(
        {
            "message": f"Generated {len(inserted_questions)} questions from the uploaded file using {generation_source}.",
            "created_count": len(inserted_questions),
            "questions": inserted_questions,
            "generation_source": generation_source,
        }
    )


@app.put("/api/instructor/questions/<int:question_id>/answer-key")
@login_required
def set_question_answer_key(question_id: int):
    """Set the answer key for a question. Only the instructor who created the session can do this."""
    payload = request.get_json(silent=True) or {}
    answer_key = str(payload.get("answer_key", "")).strip()

    if not answer_key:
        return jsonify({"error": "Answer key is required."}), 400

    with get_db() as db:
        # Get the question and verify instructor access
        question = db.execute(
            """
            SELECT q.id, q.session_code, s.creator_id
            FROM session_questions AS q
            JOIN sessions AS s ON s.session_code = q.session_code
            WHERE q.id = ?
            """,
            (question_id,),
        ).fetchone()

        if question is None:
            return jsonify({"error": "Question not found."}), 404

        # Check if current user is the creator of the session
        if question["creator_id"] != session.get("instructor_id"):
            return jsonify({"error": "You do not have permission to modify this question."}), 403

        # Update the answer key
        db.execute(
            "UPDATE session_questions SET answer_key = ? WHERE id = ?",
            (answer_key, question_id),
        )

    return jsonify(
        {
            "message": "Answer key updated successfully.",
            "question_id": question_id,
            "answer_key": answer_key,
        }
    ), 200


@app.get("/api/instructor/questions/<int:question_id>")
@login_required
def get_question_details(question_id: int):
    """Get question details including answer key (for instructors only)."""
    with get_db() as db:
        question = db.execute(
            """
            SELECT q.*, s.creator_id
            FROM session_questions AS q
            JOIN sessions AS s ON s.session_code = q.session_code
            WHERE q.id = ?
            """,
            (question_id,),
        ).fetchone()

        if question is None:
            return jsonify({"error": "Question not found."}), 404

        # Check if current user is the creator of the session
        if question["creator_id"] != session.get("instructor_id"):
            return jsonify({"error": "You do not have permission to view this question."}), 403

        return jsonify(
            {
                "id": question["id"],
                "session_code": question["session_code"],
                "question_text": question["question_text"],
                "question_type": question["question_type"],
                "answer_key": question["answer_key"],
                "created_at": question["created_at"],
            }
        ), 200


@app.get("/api/instructor/sessions/<session_code>/responses")
@instructor_session_access_required
def get_instructor_session_responses(session_code: str):
    return get_session_responses(session_code)


@app.get("/api/instructor/admin/sessions")
@login_required
def admin_sessions_overview():
    if not current_instructor_is_admin():
        return jsonify({"error": "Admin access required."}), 403

    with get_db() as db:
        sessions = db.execute(
            """
            SELECT
                s.session_code,
                s.creator_id,
                s.created_at,
                COUNT(DISTINCT q.id) AS question_count,
                COUNT(r.id) AS response_count
            FROM sessions AS s
            LEFT JOIN session_questions AS q ON q.session_code = s.session_code
            LEFT JOIN responses AS r ON r.session_code = s.session_code
            GROUP BY s.session_code, s.creator_id, s.created_at
            ORDER BY s.created_at DESC, s.session_code DESC
            """,
        ).fetchall()

        questions = db.execute(
            """
            SELECT
                q.session_code,
                q.id,
                q.question_text,
                q.question_type,
                q.created_at,
                COUNT(r.id) AS response_count
            FROM session_questions AS q
            LEFT JOIN responses AS r ON r.question_id = q.id
            GROUP BY q.session_code, q.id, q.question_text, q.created_at
            ORDER BY q.created_at DESC, q.id DESC
            """,
        ).fetchall()

        responses = db.execute(
            """
            SELECT
                r.session_code,
                r.student_id,
                r.answer,
                r.justification,
                r.submitted_at,
                r.question_id,
                q.question_type,
                q.question_text
            FROM responses AS r
            LEFT JOIN session_questions AS q ON q.id = r.question_id
            ORDER BY r.submitted_at DESC, r.id DESC
            """,
        ).fetchall()

    return jsonify(
        {
            "admin_id": current_instructor_id(),
            "sessions": [
                {
                    "session_code": row["session_code"],
                    "creator_id": row["creator_id"],
                    "created_at": row["created_at"],
                    "question_count": row["question_count"],
                    "response_count": row["response_count"],
                }
                for row in sessions
            ],
            "questions": [
                {
                    "session_code": row["session_code"],
                    "id": row["id"],
                    "question_text": row["question_text"],
                    "question_type": row["question_type"],
                    "created_at": row["created_at"],
                    "response_count": row["response_count"],
                }
                for row in questions
            ],
            "responses": [
                {
                    "session_code": row["session_code"],
                    "student_id": row["student_id"],
                    "answer": row["answer"],
                    "justification": row["justification"],
                    "submitted_at": row["submitted_at"],
                    "question_id": row["question_id"],
                    "question_type": row["question_type"],
                    "question_text": row["question_text"],
                }
                for row in responses
            ],
        }
    )


@app.post("/api/instructor/admin/reset-data")
@login_required
def admin_reset_data():
    if not current_instructor_is_admin():
        return jsonify({"error": "Admin access required."}), 403

    with get_db() as db:
        db.execute("DELETE FROM responses")
        db.execute("DELETE FROM session_question_options")
        db.execute("DELETE FROM session_questions")
        db.execute("DELETE FROM sessions")
        db.execute(
            "DELETE FROM sqlite_sequence WHERE name IN ('responses', 'session_question_options', 'session_questions', 'sessions')"
        )

    return jsonify({"message": "All session data has been cleared."})


@app.delete("/api/instructor/admin/questions/<int:question_id>")
@login_required
def admin_delete_question(question_id: int):
    if not current_instructor_is_admin():
        return jsonify({"error": "Admin access required."}), 403

    with get_db() as db:
        question = db.execute(
            """
            SELECT id, session_code, question_text
            FROM session_questions
            WHERE id = ?
            """,
            (question_id,),
        ).fetchone()

        if question is None:
            return jsonify({"error": "Question not found."}), 404

        db.execute("DELETE FROM responses WHERE question_id = ?", (question_id,))
        db.execute("DELETE FROM session_question_options WHERE question_id = ?", (question_id,))
        db.execute("DELETE FROM session_questions WHERE id = ?", (question_id,))

    return jsonify(
        {
            "message": "Question deleted.",
            "question_id": question_id,
            "session_code": question["session_code"],
            "question_text": question["question_text"],
        }
    )


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="127.0.0.1", port=port)
