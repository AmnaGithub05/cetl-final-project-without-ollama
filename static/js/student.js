const sessionCodeInput = document.getElementById('student-session-code');
const studentIdInput = document.getElementById('student-id');
const questionDisplay = document.getElementById('question-display');
const mcqAnswerPanel = document.getElementById('mcq-answer-panel');
const mcqAnswerOptions = document.getElementById('mcq-answer-options');
const manualResponseFields = document.getElementById('manual-response-fields');
const answerInput = document.getElementById('answer-input');
const justificationInput = document.getElementById('justification-input');
const submitBtn = document.getElementById('submit-response-btn');
const loadQuestionBtn = document.getElementById('load-question-btn');
const questionCounter = document.getElementById('question-counter');
const questionTypeDisplay = document.getElementById('question-type-display');
const questionOptionsDisplay = document.getElementById('question-options-display');
const studentMessage = document.getElementById('student-message');
const studentForm = document.getElementById('student-form');
const STUDENT_ID_STORAGE_KEY = 'microcheck-student-id';
const STUDENT_SESSION_CODE_STORAGE_KEY = 'microcheck-student-session-code';

let loadedSessionCode = '';
let loadedQuestionId = null;
let loadedQuestions = [];
let currentQuestionIndex = 0;
let loadedQuestionType = '';

function getSessionCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session_code')?.trim().toUpperCase() || '';
}

function setMessage(text, type = '') {
  studentMessage.textContent = text;
  studentMessage.className = `status-text ${type}`.trim();
}

function setAnswerFieldsEnabled(enabled) {
  answerInput.disabled = !enabled;
  justificationInput.disabled = !enabled;
  submitBtn.disabled = !enabled;
}


function setManualResponseVisibility(questionType) {
  const isMcq = questionType === 'mcq';
  manualResponseFields.classList.toggle('hidden', isMcq);

  if (isMcq) {
    answerInput.value = '';
    justificationInput.value = '';
  }
}


function clearSelectedMcqAnswer() {
  const selected = mcqAnswerOptions.querySelector('input[type="radio"]:checked');
  if (selected) {
    selected.checked = false;
  }
}


function formatQuestionType(questionType) {
  const labels = {
    mcq: 'Multiple choice',
    open_ended: 'Open ended',
    short_answer: 'Short answer',
  };

  return labels[questionType] || '';
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


function getSelectedMcqAnswer() {
  const selected = mcqAnswerOptions.querySelector('input[type="radio"]:checked');
  return selected ? selected.value : '';
}


function renderQuestionExtras(question) {
  const questionType = question?.question_type || '';
  const options = normalizeOptions(question?.options);
  loadedQuestionType = questionType;

  if (!questionType) {
    questionTypeDisplay.textContent = '';
    questionTypeDisplay.className = 'question-type-pill hidden';
    questionOptionsDisplay.textContent = '';
    questionOptionsDisplay.className = 'question-options-preview hidden';
    mcqAnswerPanel.classList.add('hidden');
    mcqAnswerOptions.innerHTML = '';
    manualResponseFields.classList.remove('hidden');
    return;
  }

  questionTypeDisplay.textContent = formatQuestionType(questionType);
  questionTypeDisplay.className = 'question-type-pill';

  if (questionType === 'mcq' && options.length) {
    questionOptionsDisplay.innerHTML = `
      <p class="question-options-label">Options</p>
      <ul class="mcq-option-list">
        ${options.map((option) => `<li>${option}</li>`).join('')}
      </ul>
    `;
    questionOptionsDisplay.className = 'question-options-preview';
    mcqAnswerPanel.classList.remove('hidden');
    setManualResponseVisibility('mcq');
    mcqAnswerOptions.innerHTML = options
      .map(
        (option, index) => `
          <label class="mcq-answer-option">
            <input type="radio" name="mcq-answer" value="${option}" />
            <span>${String.fromCharCode(65 + index)}. ${option}</span>
          </label>
        `,
      )
      .join('');
    return;
  }

  questionOptionsDisplay.textContent = '';
  questionOptionsDisplay.className = 'question-options-preview hidden';
  mcqAnswerPanel.classList.add('hidden');
  mcqAnswerOptions.innerHTML = '';
  setManualResponseVisibility(questionType);
}


function clearResponseFields() {
  answerInput.value = '';
  justificationInput.value = '';
}


function restoreStudentId() {
  const storedStudentId = sessionStorage.getItem(STUDENT_ID_STORAGE_KEY);
  if (storedStudentId) {
    studentIdInput.value = storedStudentId;
  }
}


function restoreStudentSessionCode() {
  const storedSessionCode = sessionStorage.getItem(STUDENT_SESSION_CODE_STORAGE_KEY);
  const sessionCodeFromUrl = getSessionCodeFromUrl();

  if (storedSessionCode) {
    sessionCodeInput.value = storedSessionCode;
  } else if (sessionCodeFromUrl) {
    sessionCodeInput.value = sessionCodeFromUrl;
    persistStudentSessionCode();
  }
}


function persistStudentId() {
  const studentId = studentIdInput.value.trim();
  if (studentId) {
    sessionStorage.setItem(STUDENT_ID_STORAGE_KEY, studentId);
  } else {
    sessionStorage.removeItem(STUDENT_ID_STORAGE_KEY);
  }
}


function persistStudentSessionCode() {
  const sessionCode = sessionCodeInput.value.trim().toUpperCase();
  if (sessionCode) {
    sessionStorage.setItem(STUDENT_SESSION_CODE_STORAGE_KEY, sessionCode);
  } else {
    sessionStorage.removeItem(STUDENT_SESSION_CODE_STORAGE_KEY);
  }
}


function updateQuestionControls() {
  const currentPosition = loadedQuestions.length ? currentQuestionIndex + 1 : 0;

  questionCounter.textContent = loadedQuestions.length ? `Question ${currentPosition} of ${loadedQuestions.length}` : '';
}


function showQuestion(index) {
  if (!loadedQuestions.length) {
    loadedQuestionId = null;
    questionDisplay.textContent = 'This session does not have any questions yet.';
    questionDisplay.className = 'question-display empty-copy';
    renderQuestionExtras(null);
    setAnswerFieldsEnabled(false);
    updateQuestionControls();
    return;
  }

  currentQuestionIndex = Math.max(0, Math.min(index, loadedQuestions.length - 1));
  const question = loadedQuestions[currentQuestionIndex];

  loadedQuestionId = question.id;
  questionDisplay.textContent = question.question_text;
  questionDisplay.className = 'question-display';
  renderQuestionExtras(question);
  clearSelectedMcqAnswer();
  answerInput.value = '';
  setManualResponseVisibility(question.question_type);
  setAnswerFieldsEnabled(true);
  updateQuestionControls();
}

function resetQuestionState(message) {
  questionDisplay.textContent = message;
  questionDisplay.className = 'question-display empty-copy';
  renderQuestionExtras(null);
  loadedSessionCode = '';
  loadedQuestionId = null;
  loadedQuestions = [];
  currentQuestionIndex = 0;
  loadedQuestionType = '';
  questionCounter.textContent = '';
  mcqAnswerPanel.classList.add('hidden');
  mcqAnswerOptions.innerHTML = '';
  manualResponseFields.classList.remove('hidden');
  setAnswerFieldsEnabled(false);
}

async function loadQuestion() {
  const sessionCode = sessionCodeInput.value.trim().toUpperCase();
  const studentId = studentIdInput.value.trim();

  if (!sessionCode) {
    setMessage('Please enter a session code.', 'error');
    resetQuestionState('Enter a session code and load the question.');
    return;
  }

  if (!studentId) {
    setMessage('Please enter your student ID.', 'error');
    resetQuestionState('Enter a session code and load the questions.');
    return;
  }

  try {
    setMessage('Loading question...');
    const response = await fetch(`/api/sessions/${sessionCode}/questions?student_id=${encodeURIComponent(studentId)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to load the session questions.');
    }

    loadedSessionCode = data.session_code;
    loadedQuestions = (data.questions || [])
      .slice()
      .reverse()
      .filter((question) => !(data.answered_question_ids || []).includes(question.id));
    currentQuestionIndex = 0;
    persistStudentSessionCode();

    if (data.completed || (!loadedQuestions.length && (data.questions || []).length > 0)) {
      setMessage('All questions have already been answered. Taking you to the all done page...', 'success');
      window.location.assign('/student/done');
      return;
    }

    if (!loadedQuestions.length) {
      showQuestion(0);
      setMessage(`Session ${data.session_code} loaded, but no questions have been added yet.`, 'error');
      return;
    }

    showQuestion(0);
    setMessage(`Session ${data.session_code} loaded successfully.`, 'success');
  } catch (error) {
    setMessage(error.message, 'error');
    resetQuestionState('Enter a session code and load the questions.');
  }
}

loadQuestionBtn.addEventListener('click', loadQuestion);

studentIdInput.addEventListener('input', persistStudentId);
sessionCodeInput.addEventListener('input', persistStudentSessionCode);

sessionCodeInput.addEventListener('change', () => {
  setMessage('');
  if (sessionCodeInput.value.trim()) {
    resetQuestionState('Click load question to fetch the questions.');
  }
});

studentForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const sessionCode = loadedSessionCode || sessionCodeInput.value.trim().toUpperCase();
  const studentId = studentIdInput.value.trim();
  const isMcq = loadedQuestionType === 'mcq';
  const answer = isMcq ? getSelectedMcqAnswer() : answerInput.value.trim();
  const justification = isMcq ? '' : justificationInput.value.trim();

  if (!sessionCode) {
    setMessage('Load a session first.', 'error');
    return;
  }

  if (!studentId || !answer || (!isMcq && !justification)) {
    setMessage('Please complete every field before submitting.', 'error');
    return;
  }

  try {
    setMessage('Submitting response...');
    const response = await fetch('/api/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_code: sessionCode,
        question_id: loadedQuestionId,
        student_id: studentId,
        answer,
        justification,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to submit your response.');
    }

    clearResponseFields();
    persistStudentId();

    if (currentQuestionIndex < loadedQuestions.length - 1) {
      showQuestion(currentQuestionIndex + 1);
      setMessage('Response submitted. Moving to the next question.', 'success');
      return;
    }

    setMessage('Response submitted. Taking you to the all done page...', 'success');
    window.location.assign('/student/done');
  } catch (error) {
    setMessage(error.message, 'error');
  }
});

restoreStudentId();
restoreStudentSessionCode();

if (sessionCodeInput.value.trim() && studentIdInput.value.trim()) {
  resetQuestionState('Loading your session questions...');
  loadQuestion();
} else {
  resetQuestionState('Enter a session code and student ID to load the questions.');
}
