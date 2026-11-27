# MicroCheck: Technical Report

## Overview

MicroCheck is a browser-based classroom response system designed to help instructors check student understanding during or after a lesson. It combines a Flask backend, a lightweight browser interface, SQLite storage, and optional AI services. The central idea is simple: an instructor creates a session, students join with a short code, and their answers are collected in one place for immediate review. The system is intentionally small enough to run locally, but it also includes configuration for deployment on Render.

## System Architecture

The application is built as a Python Flask web server. Flask serves the HTML pages and exposes JSON-based REST endpoints used by the JavaScript frontend. The interface is split into instructor and student workflows and is rendered with Jinja templates. Browser behavior is handled with plain JavaScript and CSS, so there is no frontend build step or large client framework to maintain.

SQLite is the persistence layer. On startup, the application creates or updates its database schema automatically. The database stores sessions, questions, multiple-choice options, student responses, misconception results, instructor resources, and timestamps. Foreign keys and cascading deletes keep related records consistent when sessions or questions are removed. Session codes are generated as unique six-character values using Python's `secrets` module.

## Main Features and Data Flow

An instructor signs in with an instructor ID and creates a session. The application records the session owner and returns a shareable six-character code and URL. Instructors can add open-ended, short-answer, or multiple-choice questions, including up to four answer options for MCQs. A session can contain several questions rather than being limited to one prompt.

Students enter the session code and their student ID. The frontend loads the available questions, tracks which questions that student has already answered, and prevents duplicate submissions. Open-ended questions require both an answer and a justification; MCQs use selectable options and do not require a separate justification. When all questions are complete, the student is sent to a completion page. Student IDs and session codes are retained in browser session storage to make returning to a session easier.

Instructor pages refresh response data automatically and display question counts, response totals, submission times, answer tables, and per-question pie charts. Charts group common answers and provide an interactive legend and detail popup. The session dashboard also supports answer keys and misconception analytics. Administrators can view all sessions, questions, and responses, delete individual questions, or reset session data.

## AI and File Processing

Instructors can upload PDF, PowerPoint, Word, HTML, or plain-text lecture material. The server extracts text using `pypdf`, `python-pptx`, and `python-docx`, removes basic HTML markup, and normalizes the extracted content. Gemini is then called through its HTTP API to generate a requested number of reasoning-focused multiple-choice and open-ended questions. Responses are requested as JSON and validated before they are saved, with fallback handling for malformed model output and unavailable model variants.

Student answers can also be analyzed by a private local Ollama service. The configured small language model evaluates the answer against the question and optional answer key, returning a misconception code, confidence score, severity, and short feedback. Results are stored with the response and shown to instructors. If Ollama is unavailable, the original response is still saved, so AI analysis does not interrupt classroom collection. The default model is `llama3.2:1b`, and the Ollama host, model, and timeout are configurable through environment variables.

## Security, Deployment, and Limitations

Instructor-only routes use Flask sessions and decorators for login and session ownership checks. Three configured IDs have administrator access, while other instructors can manage only sessions they created. API errors are returned as JSON, and a `/health` endpoint supports deployment checks. Production configuration uses Gunicorn, a generated secret key, environment variables for credentials, and a persistent Render disk for the SQLite database.

The project is deliberately lightweight: authentication is ID-based rather than password- or identity-provider-based, and SQLite is best suited to a small classroom or modest deployment rather than heavy concurrent traffic. Gemini requires an API key, while misconception detection requires a separately running Ollama service. Within those boundaries, MicroCheck provides a practical, human-centered way to turn classroom answers into immediate instructional feedback.
