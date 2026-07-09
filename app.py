from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from functools import wraps

from flask import Flask, jsonify, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("MICROCHECK_DB_PATH", str(BASE_DIR / "microcheck.db")))

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False
app.secret_key = os.environ.get("MICROCHECK_SECRET_KEY", "dev-microcheck-secret-key")

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
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_code) REFERENCES sessions(session_code) ON DELETE CASCADE
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


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if not current_instructor_id():
            return redirect(url_for("instructor_access_page"))
        return view(*args, **kwargs)

    return wrapped_view


def instructor_session_access_required(view):
    @wraps(view)
    def wrapped_view(session_code: str, *args, **kwargs):
        instructor_id = current_instructor_id()
        if not instructor_id:
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
            SELECT id, session_code, question_text, created_at
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

    if not question_text:
        return jsonify({"error": "Question text is required."}), 400

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
            INSERT INTO session_questions (session_code, question_text, created_at)
            VALUES (?, ?, ?)
            """,
            (session_code.upper(), question_text, created_at),
        )

    return (
        jsonify(
            {
                "id": cursor.lastrowid,
                "session_code": session_code.upper(),
                "question_text": question_text,
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

    if not session_code or not student_id or not answer or not justification:
        return jsonify({"error": "All fields are required."}), 400

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

        submitted_at = utc_now()
        db.execute(
            """
            INSERT INTO responses (session_code, question_id, student_id, answer, justification, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_code, question_id, student_id, answer, justification, submitted_at),
        )

    return jsonify({"message": "Response submitted successfully.", "submitted_at": submitted_at}), 201


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
                r.student_id,
                r.answer,
                r.justification,
                r.submitted_at,
                r.question_id,
                q.question_text
            FROM responses AS r
            LEFT JOIN session_questions AS q ON q.id = r.question_id
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
                    "question_text": row["question_text"],
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

    return jsonify(
        {
            "session_code": session_code.upper(),
            "questions": [
                {
                    "id": row["id"],
                    "session_code": row["session_code"],
                    "question_text": row["question_text"],
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
                    "question_text": row["question_text"],
                }
                for row in responses
            ],
        }
    )


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="127.0.0.1", port=port)
