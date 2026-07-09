const createSessionForm = document.getElementById('create-session-form');
const questionInput = document.getElementById('question-input');
const sessionCodeEl = document.getElementById('session-code');
const totalResponsesEl = document.getElementById('total-responses');
const dashboardMessage = document.getElementById('dashboard-message');
const responsesTableBody = document.getElementById('responses-table-body');
const refreshBtn = document.getElementById('refresh-btn');

let activeSessionCode = '';
let refreshTimer = null;

function setMessage(text, type = '') {
  dashboardMessage.textContent = text;
  dashboardMessage.className = `status-text ${type}`.trim();
}

function formatTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleString();
}

function renderResponses(responses) {
  if (!responses.length) {
    responsesTableBody.innerHTML = '<tr><td colspan="4" class="empty-state">No responses yet. Share the session code with students.</td></tr>';
    return;
  }

  responsesTableBody.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td><strong>${response.student_id}</strong></td>
          <td>${response.answer}</td>
          <td>${response.justification}</td>
          <td>${formatTime(response.submitted_at)}</td>
        </tr>
      `,
    )
    .join('');
}

async function loadResponses(sessionCode) {
  if (!sessionCode) {
    return;
  }

  try {
    const response = await fetch(`/api/sessions/${sessionCode}/responses`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to load responses.');
    }

    sessionCodeEl.textContent = data.session_code;
    totalResponsesEl.textContent = data.total_responses;
    renderResponses(data.responses);
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function startAutoRefresh(sessionCode) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    loadResponses(sessionCode);
  }, 4000);
}

createSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();

  if (!question) {
    setMessage('Please enter a question before creating a session.', 'error');
    return;
  }

  try {
    setMessage('Creating session...');
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to create session.');
    }

    activeSessionCode = data.session_code;
    sessionCodeEl.textContent = data.session_code;
    totalResponsesEl.textContent = '0';
    renderResponses([]);
    setMessage(`Session created. Share code ${data.session_code} with students.`, 'success');
    await loadResponses(activeSessionCode);
    startAutoRefresh(activeSessionCode);
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

refreshBtn.addEventListener('click', () => {
  if (!activeSessionCode) {
    setMessage('Create a session first.', 'error');
    return;
  }
  loadResponses(activeSessionCode);
});

renderResponses([]);
