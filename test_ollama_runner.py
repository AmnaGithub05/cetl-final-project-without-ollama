from ollama_runner import OllamaRunner


def test_misconception_fallback_uses_conceptual_error_for_contradictory_answer():
    runner = OllamaRunner()
    parsed = {
        "misconception_code": None,
        "confidence_score": 0.76,
        "severity": "MEDIUM",
        "slm_feedback": "This answer suggests a likely misunderstanding of the underlying concept."
    }

    result = runner._finalize_misconception(
        parsed,
        question='A plant grows taller because it absorbs sunlight directly into its roots.',
        answer='It grows taller because sunlight is absorbed by the roots, which then increases mass.',
        answer_key='Plants grow taller mainly because they convert light energy into chemical energy through photosynthesis in the leaves, not because roots absorb sunlight directly.'
    )

    assert result["misconception_code"] == "CONCEPTUAL_ERROR"
    assert result["severity"] in {"LOW", "MEDIUM", "HIGH"}
    assert result["confidence_score"] == 0.76


def test_correct_answer_remains_null():
    runner = OllamaRunner()
    parsed = {
        "misconception_code": None,
        "confidence_score": 0.9,
        "severity": "LOW",
        "slm_feedback": "The answer is broadly correct and explains the concept accurately."
    }

    result = runner._finalize_misconception(
        parsed,
        question='What is the main source of energy for plants?',
        answer='Plants use sunlight to make food through photosynthesis.',
        answer_key='Plants use sunlight for photosynthesis to make glucose.'
    )

    assert result["misconception_code"] is None
