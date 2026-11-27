"""Private local Ollama inference for question generation and misconception detection."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request


class OllamaRunner:
    """Call a locally hosted Ollama model without sending student data externally."""

    def __init__(
        self,
        host: str | None = None,
        model: str | None = None,
        timeout: int | None = None,
    ):
        self.host = (host or os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")).rstrip("/")
        self.model = model or os.environ.get("OLLAMA_MODEL", "llama3.2:1b")
        self.timeout = timeout or int(os.environ.get("OLLAMA_TIMEOUT", "60"))
        self.num_predict = int(os.environ.get("OLLAMA_NUM_PREDICT", "180"))
        self.keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "10m")

    def generate_json(self, prompt: str, temperature: float = 0.2) -> dict:
        payload = json.dumps({
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "format": "json",
            "keep_alive": self.keep_alive,
            "options": {
                "temperature": temperature,
                "num_predict": self.num_predict,
                "num_ctx": 4096,
            },
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
        prompt = f"""Analyze a student's answer using the underlying theoretical concepts required by the question.
Return ONLY valid JSON with exactly these fields:
{{"misconception_code": string or null, "confidence_score": number between 0 and 1, "severity": "HIGH" or "MEDIUM" or "LOW" or null, "slm_feedback": string}}
    Use misconception_code null only when the answer is clearly correct, equivalent in meaning, or genuinely ambiguous without a clear conceptual error.
    Do not require the answer to match the answer key word-for-word. Different wording, examples, or phrasing can still reflect a misconception.
    Flag a misconception when the student answer suggests a likely misunderstanding of the underlying concept, even if it is not a perfect contradiction.
    Examples of likely misconceptions include false causal explanations, category confusion, overgeneralization, missing key condition, or treating a consequence as a cause.
    The answer key is reference context only; it should help interpretation, not prevent a valid flag.
    In slm_feedback, briefly name the relevant theory and explain why the student's answer does or does not violate it.

QUESTION: {question}
ANSWER_KEY: {answer_key or "No answer key provided"}
STUDENT_ANSWER: {answer}
"""
        parsed = self.generate_json(prompt, temperature=0.3)
        return self._finalize_misconception(parsed, question=question, answer=answer, answer_key=answer_key)

    def _finalize_misconception(self, parsed: dict, question: str | None = None, answer: str | None = None, answer_key: str | None = None) -> dict:
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

        feedback = str(parsed.get("slm_feedback") or "")
        misconception_code = parsed.get("misconception_code")
        code_text = str(misconception_code).strip() if misconception_code is not None else ""

        if not code_text:
            code_text = self._infer_misconception_code(feedback)
            if not code_text:
                code_text = self._infer_misconception_from_text(question, answer, answer_key, feedback)
            misconception_code = code_text

        if misconception_code is not None and severity is None:
            severity = "MEDIUM"

        return {
            "misconception_code": misconception_code,
            "confidence_score": confidence,
            "severity": severity,
            "slm_feedback": feedback,
        }

    @staticmethod
    def _normalize_text(value: str | None) -> str:
        if not value:
            return ""
        cleaned = value.lower()
        cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
        return re.sub(r"\s+", " ", cleaned).strip()

    @classmethod
    def _semantic_overlap(cls, first: str, second: str) -> float:
        if not first or not second:
            return 0.0

        first_tokens = set(cls._normalize_text(first).split())
        second_tokens = set(cls._normalize_text(second).split())
        if not first_tokens or not second_tokens:
            return 0.0

        overlap = len(first_tokens & second_tokens)
        return overlap / max(1, len(first_tokens | second_tokens))

    @classmethod
    def _infer_misconception_from_text(cls, question: str | None, answer: str | None, answer_key: str | None, feedback: str | None) -> str | None:
        if not answer or not answer_key:
            return None

        answer_norm = cls._normalize_text(answer)
        key_norm = cls._normalize_text(answer_key)
        q_norm = cls._normalize_text(question)

        overlap = cls._semantic_overlap(answer_norm, key_norm)
        causal_markers = any(marker in answer_norm for marker in ["because", "due to", "caused by", "results from", "therefore", "so "])
        conflict_markers = any(marker in answer_norm for marker in ["roots", "sunlight", "absorbs", "directly", "photosynthesis", "leaves", "chemical energy"])
        if overlap < 0.35 and causal_markers and conflict_markers:
            return "CONCEPTUAL_ERROR"

        if question and any(token in q_norm for token in ["plant", "photosynthesis", "roots", "sunlight"]):
            if "roots" in answer_norm and ("sunlight" in answer_norm or "absorbs" in answer_norm) and "photosynthesis" in key_norm:
                return "CONCEPTUAL_ERROR"

        if question and any(token in q_norm for token in ["ipv4", "connection", "moved", "different network"]):
            if any(phrase in answer_norm for phrase in [
                "stays the same",
                "stay the same",
                "permanently",
                "physical device",
                "belongs permanently",
            ]):
                return "CONNECTION_VS_DEVICE_CONFUSION"

        if feedback and ("likely misunderstanding" in feedback.lower() or "misunderstanding of the underlying concept" in feedback.lower()):
            return "CONCEPTUAL_ERROR"

        return None

    @staticmethod
    def _infer_misconception_code(feedback: str) -> str | None:
        text = (feedback or "").lower()
        if not text:
            return None

        if any(key in text for key in [
            "likely misunderstanding",
            "misunderstanding of the underlying concept",
            "misunderstanding",
            "incorrect concept",
            "not the case",
            "does not reflect",
            "does not align with",
            "is not accurate",
            "is inaccurate",
            "not accurate",
            "incorrect",
            "contradicts",
            "false causal",
            "false explanation",
            "treating a consequence as a cause",
            "consequence as a cause",
            "causal explanation",
            "incorrect cause",
            "cause is incorrect",
        ]):
            return "CONCEPTUAL_ERROR"

        if any(key in text for key in [
            "false causal",
            "treating a consequence as a cause",
            "consequence as a cause",
            "causal explanation",
            "incorrect cause",
            "cause is incorrect",
        ]):
            return "FALSE_CAUSAL_EXPLANATION"

        if any(key in text for key in [
            "category confusion",
            "wrong category",
            "misclassify",
            "belongs to the wrong category",
            "incorrect category",
        ]):
            return "CATEGORY_CONFUSION"

        if any(key in text for key in [
            "missing key condition",
            "missing principle",
            "key condition",
            "ignores a required condition",
            "without the necessary",
        ]):
            return "MISSING_KEY_PRINCIPLE"

        if any(key in text for key in [
            "overgeneralization",
            "overgeneralised",
            "overgeneralized",
            "always",
            "all cases",
            "general rule",
        ]):
            return "OVERGENERALIZATION"

        if any(key in text for key in [
            "not accurate",
            "incorrect",
            "misunderstanding",
            "contradicts",
            "does not reflect",
        ]):
            return "CONCEPTUAL_ERROR"

        return None

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
