import requests

base = 'http://127.0.0.1:5000'
code = 'GQN4XF'
questions = requests.get(f'{base}/api/sessions/{code}/questions', timeout=30).json().get('questions', [])
choices = ['Fragmenting', 'Packetizing', 'Routing', 'Addressing']
students = [f'S{i:03d}' for i in range(1, 11)]

sent = 0
for sid in students:
    for idx, q in enumerate(questions):
        payload = {
            'session_code': code,
            'student_id': sid,
            'question_id': q['id'],
            'answer': choices[(idx + int(sid[1:])) % len(choices)],
            'justification': ''
        }
        response = requests.post(f'{base}/api/responses', json=payload, timeout=30)
        if response.status_code in (200, 201):
            sent += 1

print('TOTAL_SUBMISSIONS_ATTEMPTED', sent)
print('TOTAL_QUESTIONS', len(questions))
print('TOTAL_STUDENTS', len(students))
print('EXPECTED', len(questions) * len(students))
