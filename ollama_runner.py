"""Private local Ollama inference for question generation and misconception detection."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request


class OllamaRunner:
    """Call a locally hosted Ollama model without sending student data externally."""

    def __init__(self, host: str | None = None, model: str | None = None, timeout: int | None = None):
        self.host = (host or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")).rstrip("/")
        self.model = model or os.environ.get("OLLAMA_MODEL", "llama3.2:1b")
        self.timeout = timeout or int(os.environ.get("OLLAMA_TIMEOUT", "60"))

    def generate_json(self, prompt: str, temperature: float = 0.2) -> dict:
        payload = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "options": {"temperature": temperature},
        }).encode("utf-8")
        request = urllib.request.Request(
            f"{self.host}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            details = error.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"Ollama request failed: {details or error}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Ollama is unavailable at {self.host}: {error.reason}") from error

        return self._parse_json(result.get("response", ""))

    def predict_misconception(self, question: str, answer: str, answer_key: str | None = None) -> dict:
        prompt = f"""Analyze a student's answer against the instructor's answer key.
Return ONLY valid JSON with exactly these fields:
{{"misconception_code": string or null, "confidence_score": number between 0 and 1, "severity": "HIGH" or "MEDIUM" or "LOW" or null, "slm_feedback": string}}
Use misconception_code null when the answer is correct or no misconception is identifiable.

QUESTION: {question}
ANSWER_KEY: {answer_key or "No answer key provided"}
STUDENT_ANSWER: {answer}
"""
        parsed = self.generate_json(prompt, temperature=0.1)
        confidence = parsed.get("confidence_score")
        try:
            confidence = max(0.0, min(1.0, float(confidence))) if confidence is not None else None
        except (TypeError, ValueError):
            confidence = None

        severity = parsed.get("severity")
        if isinstance(severity, str):
            severity = severity.upper()
        if severity not in {"HIGH", "MEDIUM", "LOW", None}:
            severity = None

        return {
            "misconception_code": parsed.get("misconception_code"),
            "confidence_score": confidence,
            "severity": severity,
            "slm_feedback": str(parsed.get("slm_feedback") or ""),
        }

    @staticmethod
    def _parse_json(output: str) -> dict:
        try:
            parsed = json.loads(output)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", output, re.DOTALL)
            if not match:
                raise ValueError("Ollama returned invalid JSON")
            parsed = json.loads(match.group(0))
        if not isinstance(parsed, dict):
            raise ValueError("Ollama returned JSON that was not an object")
        return parsed
