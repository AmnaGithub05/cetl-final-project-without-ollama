const adminSessionsBody = document.getElementById('admin-sessions-body');
const adminQuestionsBody = document.getElementById('admin-questions-body');
const adminResponsesBody = document.getElementById('admin-responses-body');

function formatTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleString();
}

function renderSessions(sessions) {
  if (!sessions.length) {
    adminSessionsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No sessions have been created yet.</td></tr>';
    return;
  }

  adminSessionsBody.innerHTML = sessions
    .map(
      (sessionRow) => `
        <tr>
          <td><a href="/instructor/sessions/${sessionRow.session_code}"><strong>${sessionRow.session_code}</strong></a></td>
          <td>${sessionRow.creator_id || 'Unknown'}</td>
          <td>${sessionRow.question_count}</td>
          <td>${sessionRow.response_count}</td>
          <td>${formatTime(sessionRow.created_at)}</td>
        </tr>
      `,
    )
    .join('');
}

function renderQuestions(questions) {
  if (!questions.length) {
    adminQuestionsBody.innerHTML = '<tr><td colspan="4" class="empty-state">No questions yet.</td></tr>';
    return;
  }

  adminQuestionsBody.innerHTML = questions
    .map(
      (question) => `
        <tr>
          <td><strong>${question.session_code}</strong></td>
          <td>${question.question_text}</td>
          <td>${question.response_count}</td>
          <td>${formatTime(question.created_at)}</td>
        </tr>
      `,
    )
    .join('');
}

function renderResponses(responses) {
  if (!responses.length) {
    adminResponsesBody.innerHTML = '<tr><td colspan="6" class="empty-state">No responses yet.</td></tr>';
    return;
  }

  adminResponsesBody.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td><strong>${response.session_code}</strong></td>
          <td>${response.student_id}</td>
          <td>${response.question_text || 'Question removed'}</td>
          <td>${response.answer}</td>
          <td>${response.justification}</td>
          <td>${formatTime(response.submitted_at)}</td>
        </tr>
      `,
    )
    .join('');
}

async function loadAdminData() {
  const response = await fetch('/api/instructor/admin/sessions');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load admin data.');
  }

  renderSessions(data.sessions || []);
  renderQuestions(data.questions || []);
  renderResponses(data.responses || []);
}

loadAdminData().catch((error) => {
  adminSessionsBody.innerHTML = `<tr><td colspan="5" class="empty-state">${error.message}</td></tr>`;
  adminQuestionsBody.innerHTML = `<tr><td colspan="4" class="empty-state">${error.message}</td></tr>`;
  adminResponsesBody.innerHTML = `<tr><td colspan="6" class="empty-state">${error.message}</td></tr>`;
});