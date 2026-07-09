const sessionPage = document.getElementById('session-page');
const sessionCode = sessionPage.dataset.sessionCode;
const questionInput = document.getElementById('question-input');
const addQuestionForm = document.getElementById('add-question-form');
const questionCountEl = document.getElementById('question-count');
const totalResponsesEl = document.getElementById('total-responses');
const latestQuestionDisplay = document.getElementById('latest-question-display');
const dashboardMessage = document.getElementById('dashboard-message');
const questionsList = document.getElementById('questions-list');
const responsesTableBody = document.getElementById('responses-table-body');
const refreshBtn = document.getElementById('refresh-btn');

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

function renderQuestions(questions) {
  if (!questions.length) {
    latestQuestionDisplay.textContent = 'No questions have been added yet.';
    latestQuestionDisplay.className = 'question-display empty-copy';
    questionsList.innerHTML = '<div class="empty-state">No questions yet. Add the first one on the left.</div>';
    return;
  }

  latestQuestionDisplay.textContent = questions[0].question_text;
  latestQuestionDisplay.className = 'question-display';

  questionsList.innerHTML = questions
    .map(
      (question) => `
        <article class="question-list-item">
          <div>
            <p class="question-list-text">${question.question_text}</p>
            <p class="question-list-meta">Added ${formatTime(question.created_at)}</p>
          </div>
          <div class="question-list-count">
            <strong>${question.response_count}</strong>
            <span>responses</span>
          </div>
        </article>
      `,
    )
    .join('');
}

function renderResponses(responses) {
  if (!responses.length) {
    responsesTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No responses yet. Share the session code with students.</td></tr>';
    return;
  }

  responsesTableBody.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td>${response.question_text || 'Question removed'}</td>
          <td><strong>${response.student_id}</strong></td>
          <td>${response.answer}</td>
          <td>${response.justification}</td>
          <td>${formatTime(response.submitted_at)}</td>
        </tr>
      `,
    )
    .join('');
}

async function loadSessionData() {
  try {
    const [sessionResponse, questionsResponse, responsesResponse] = await Promise.all([
      fetch(`/api/instructor/sessions/${sessionCode}`),
      fetch(`/api/instructor/sessions/${sessionCode}/questions`),
      fetch(`/api/instructor/sessions/${sessionCode}/responses`),
    ]);

    const sessionData = await sessionResponse.json();
    const questionsData = await questionsResponse.json();
    const responsesData = await responsesResponse.json();

    if (!sessionResponse.ok) {
      throw new Error(sessionData.error || 'Unable to load session.');
    }

    if (!questionsResponse.ok) {
      throw new Error(questionsData.error || 'Unable to load questions.');
    }

    if (!responsesResponse.ok) {
      throw new Error(responsesData.error || 'Unable to load responses.');
    }

    questionCountEl.textContent = sessionData.question_count;
    totalResponsesEl.textContent = responsesData.total_responses;
    renderQuestions(questionsData.questions);
    renderResponses(responsesData.responses);
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

async function addQuestion() {
  const questionText = questionInput.value.trim();

  if (!questionText) {
    setMessage('Please enter a question before adding it.', 'error');
    return;
  }

  try {
    setMessage('Adding question...');
    const response = await fetch(`/api/instructor/sessions/${sessionCode}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: questionText }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to add question.');
    }

    questionInput.value = '';
    setMessage('Question added successfully.', 'success');
    await loadSessionData();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(loadSessionData, 4000);
}

addQuestionForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addQuestion();
});

refreshBtn.addEventListener('click', loadSessionData);

loadSessionData();
startAutoRefresh();