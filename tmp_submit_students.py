import requests

base = "http://127.0.0.1:5000"
code = "GQN4XF"
questions_response = requests.get(f"{base}/api/sessions/{code}/questions", timeout=30)
questions_response.raise_for_status()
questions = questions_response.json().get("questions", [])
choices = ["Fragmenting", "Packetizing", "Routing", "Addressing"]

for sid in [f"S{i:03d}" for i in range(1, 11)]:
    for idx, q in enumerate(questions):
        answer = choices[(idx + int(sid[1:])) % len(choices)]
        payload = {
            "session_code": code,
            "student_id": sid,
            "question_id": q["id"],
            "answer": answer,
            "justification": "",
        }
        response = requests.post(f"{base}/api/responses", json=payload, timeout=30)
        body = response.json()
        print(f"{sid} q{q['id']} -> {response.status_code} | {body.get('message')} | misconception={body.get('misconception')}")
