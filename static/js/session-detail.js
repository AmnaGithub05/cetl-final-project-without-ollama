const sessionPage = document.getElementById('session-page');
const sessionCode = sessionPage.dataset.sessionCode;
const questionTypeInput = document.getElementById('question-type-input');
const questionInput = document.getElementById('question-input');
const importQuestionsForm = document.getElementById('import-questions-form');
const lectureFileInput = document.getElementById('lecture-file-input');
const questionCountInput = document.getElementById('question-count-input');
const importMessage = document.getElementById('import-message');
const mcqOptionsPanel = document.getElementById('mcq-options-panel');
const latestQuestionOptions = document.getElementById('latest-question-options');
const mcqOptionInputs = [
  document.getElementById('mcq-option-1'),
  document.getElementById('mcq-option-2'),
  document.getElementById('mcq-option-3'),
  document.getElementById('mcq-option-4'),
];
const addQuestionForm = document.getElementById('add-question-form');
const questionCountEl = document.getElementById('question-count');
const totalResponsesEl = document.getElementById('total-responses');
const latestQuestionDisplay = document.getElementById('latest-question-display');
const latestQuestionType = document.getElementById('latest-question-type');
const dashboardMessage = document.getElementById('dashboard-message');
const questionsList = document.getElementById('questions-list');
const responsesTableBody = document.getElementById('responses-table-body');
const refreshBtn = document.getElementById('refresh-btn');

let refreshTimer = null;

function setMessage(text, type = '') {
  dashboardMessage.textContent = text;
  dashboardMessage.className = `status-text ${type}`.trim();
}


function setImportMessage(text, type = '') {
  if (!importMessage) {
    return;
  }

  importMessage.textContent = text;
  importMessage.className = `status-text ${type}`.trim();
}

function formatTime(timestamp) {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleString();
}


function formatQuestionType(questionType) {
  const labels = {
    mcq: 'Multiple choice',
    open_ended: 'Open ended',
    short_answer: 'Short answer',
  };

  return labels[questionType] || 'Open ended';
}


function normalizeOptions(options) {
  return (options || [])
    .map((option) => {
      if (option && typeof option === 'object') {
        return String(option.option_text || '').trim();
      }

      return String(option).trim();
    })
    .filter(Boolean);
}


function clearMcqOptions() {
  mcqOptionInputs.forEach((input) => {
    input.value = '';
  });
}


function getMcqOptions() {
  return normalizeOptions(mcqOptionInputs.map((input) => input.value));
}


function setQuestionTypeUi(questionType) {
  const isMcq = questionType === 'mcq';
  mcqOptionsPanel.classList.toggle('hidden', !isMcq);

  if (!isMcq) {
    clearMcqOptions();
  }
}


function updateLatestQuestionType(questionType) {
  if (!questionType) {
    latestQuestionType.textContent = '';
    latestQuestionType.className = 'question-type-pill hidden';
    latestQuestionOptions.textContent = '';
    latestQuestionOptions.className = 'question-options-preview hidden';
    return;
  }

  latestQuestionType.textContent = formatQuestionType(questionType);
  latestQuestionType.className = 'question-type-pill';
}


function renderQuestionOptions(questionType, options) {
  if (questionType !== 'mcq') {
    latestQuestionOptions.textContent = '';
    latestQuestionOptions.className = 'question-options-preview hidden';
    return;
  }

  const normalizedOptions = normalizeOptions(options);

  if (!normalizedOptions.length) {
    latestQuestionOptions.textContent = '';
    latestQuestionOptions.className = 'question-options-preview hidden';
    return;
  }

  latestQuestionOptions.innerHTML = `
    <p class="question-options-label">Options</p>
    <ul class="mcq-option-list">
      ${normalizedOptions.map((option) => `<li>${option}</li>`).join('')}
    </ul>
  `;
  latestQuestionOptions.className = 'question-options-preview';
}

function renderQuestions(questions) {
  if (!questions.length) {
    latestQuestionDisplay.textContent = 'No questions have been added yet.';
    latestQuestionDisplay.className = 'question-display empty-copy';
    updateLatestQuestionType('');
    questionsList.innerHTML = '<div class="empty-state">No questions yet. Add the first one on the left.</div>';
    return;
  }

  latestQuestionDisplay.textContent = questions[0].question_text;
  latestQuestionDisplay.className = 'question-display';
  updateLatestQuestionType(questions[0].question_type);
  renderQuestionOptions(questions[0].question_type, questions[0].options);

  questionsList.innerHTML = questions
    .map(
      (question) => `
        <article class="question-list-item">
          <div>
            <p class="question-list-text">${question.question_text}</p>
            <p class="question-list-meta">Added ${formatTime(question.created_at)}</p>
            <p class="question-list-meta">Type: ${formatQuestionType(question.question_type)}</p>
            ${question.question_type === 'mcq' && normalizeOptions(question.options).length ? `
              <ul class="mcq-option-list question-list-options">
                ${normalizeOptions(question.options).map((option) => `<li>${option}</li>`).join('')}
              </ul>
            ` : ''}
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
    responsesTableBody.innerHTML = '<tr><td colspan="6" class="empty-state">No responses yet. Share the session code with students.</td></tr>';
    return;
  }

  responsesTableBody.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td>${response.question_text || 'Question removed'}</td>
          <td>${formatQuestionType(response.question_type)}</td>
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
  const questionType = questionTypeInput.value;
  const options = questionType === 'mcq' ? getMcqOptions() : [];

  if (!questionText) {
    setMessage('Please enter a question before adding it.', 'error');
    return;
  }

  if (questionType === 'mcq' && options.length < 2) {
    setMessage('Add at least two options for an MCQ question.', 'error');
    return;
  }

  try {
    setMessage('Adding question...');
    const response = await fetch(`/api/instructor/sessions/${sessionCode}/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question_text: questionText, question_type: questionType, options }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to add question.');
    }

    questionInput.value = '';
    questionTypeInput.value = 'open_ended';
    clearMcqOptions();
    setQuestionTypeUi('open_ended');
    setMessage('Question added successfully.', 'success');
    await loadSessionData();
  } catch (error) {
    setMessage(error.message, 'error');
  }
}


async function importQuestionsFromFile() {
  const uploadedFile = lectureFileInput.files[0];
  const questionCount = questionCountInput ? questionCountInput.value : '10';

  if (!uploadedFile) {
    setImportMessage('Please choose a lecture file first.', 'error');
    return;
  }

  try {
    setImportMessage('Generating questions from the file...');
    const formData = new FormData();
    formData.append('file', uploadedFile);
    formData.append('question_count', questionCount);

    const response = await fetch(`/api/instructor/sessions/${sessionCode}/import-questions`, {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to generate questions from file.');
    }

    lectureFileInput.value = '';
    setImportMessage(data.message || 'Questions generated from the file.', 'success');
    await loadSessionData();
  } catch (error) {
    setImportMessage(error.message, 'error');
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

if (importQuestionsForm) {
  importQuestionsForm.addEventListener('submit', (event) => {
    event.preventDefault();
    importQuestionsFromFile();
  });
}

questionTypeInput.addEventListener('change', () => {
  setQuestionTypeUi(questionTypeInput.value);
});

refreshBtn.addEventListener('click', loadSessionData);

setQuestionTypeUi(questionTypeInput.value);
loadSessionData();
startAutoRefresh();