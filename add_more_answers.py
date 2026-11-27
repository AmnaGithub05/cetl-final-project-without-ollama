import random
import requests

base = 'http://127.0.0.1:5000'
code = 'GQN4XF'
questions = requests.get(f'{base}/api/sessions/{code}/questions', timeout=30).json().get('questions', [])
answers = ['Fragmenting', 'Packetizing', 'Routing', 'Addressing']
students = [f'S{i:03d}' for i in range(1, 13)]

for sid in students:
    for idx, q in enumerate(questions):
        answer = answers[(idx + int(sid[1:])) % len(answers)]
        if random.random() < 0.7:
            answer = answers[(idx + 1 + int(sid[1:])) % len(answers)]
        payload = {
            'session_code': code,
            'student_id': sid,
            'question_id': q['id'],
            'answer': answer,
            'justification': ''
        }
        requests.post(f'{base}/api/responses', json=payload, timeout=30)

summary = requests.get(f'{base}/api/sessions/{code}/responses', timeout=30).json()
print('TOTAL_RESPONSES', len(summary.get('responses', [])))
print('MISCONCEPTION_COUNT', sum(1 for x in summary.get('responses', []) if x.get('misconception_code')))
print('SAMPLE', summary.get('responses', [])[:3])
