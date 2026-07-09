const sessionCodeInput = document.getElementById('student-session-code');
const studentIdInput = document.getElementById('student-id');
const questionDisplay = document.getElementById('question-display');
const answerInput = document.getElementById('answer-input');
const justificationInput = document.getElementById('justification-input');
const submitBtn = document.getElementById('submit-response-btn');
const loadQuestionBtn = document.getElementById('load-question-btn');
const questionCounter = document.getElementById('question-counter');
const studentMessage = document.getElementById('student-message');
const studentForm = document.getElementById('student-form');
const STUDENT_ID_STORAGE_KEY = 'microcheck-student-id';
const STUDENT_SESSION_CODE_STORAGE_KEY = 'microcheck-student-session-code';

let loadedSessionCode = '';
let loadedQuestionId = null;
let loadedQuestions = [];
let currentQuestionIndex = 0;

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
    setAnswerFieldsEnabled(false);
    updateQuestionControls();
    return;
  }

  currentQuestionIndex = Math.max(0, Math.min(index, loadedQuestions.length - 1));
  const question = loadedQuestions[currentQuestionIndex];

  loadedQuestionId = question.id;
  questionDisplay.textContent = question.question_text;
  questionDisplay.className = 'question-display';
  setAnswerFieldsEnabled(true);
  updateQuestionControls();
}

function resetQuestionState(message) {
  questionDisplay.textContent = message;
  questionDisplay.className = 'question-display empty-copy';
  loadedSessionCode = '';
  loadedQuestionId = null;
  loadedQuestions = [];
  currentQuestionIndex = 0;
  questionCounter.textContent = '';
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
  const answer = answerInput.value.trim();
  const justification = justificationInput.value.trim();

  if (!sessionCode) {
    setMessage('Load a session first.', 'error');
    return;
  }

  if (!studentId || !answer || !justification) {
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
