const studentAccessForm = document.getElementById('student-access-form');
const splashStudentIdInput = document.getElementById('splash-student-id-input');
const splashSessionCodeInput = document.getElementById('splash-session-code-input');

const STUDENT_ID_KEY = 'microcheck-student-id';
const STUDENT_SESSION_CODE_KEY = 'microcheck-student-session-code';

function getSessionCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('session_code')?.trim().toUpperCase() || '';
}

function restoreInputs() {
  const storedStudentId = sessionStorage.getItem(STUDENT_ID_KEY);
  const storedSessionCode = sessionStorage.getItem(STUDENT_SESSION_CODE_KEY);
  const sessionCodeFromUrl = getSessionCodeFromUrl();

  if (storedStudentId) {
    splashStudentIdInput.value = storedStudentId;
  }

  if (storedSessionCode) {
    splashSessionCodeInput.value = storedSessionCode;
  } else if (sessionCodeFromUrl) {
    splashSessionCodeInput.value = sessionCodeFromUrl;
    sessionStorage.setItem(STUDENT_SESSION_CODE_KEY, sessionCodeFromUrl);
  }
}

studentAccessForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const studentId = splashStudentIdInput.value.trim();
  const sessionCode = splashSessionCodeInput.value.trim().toUpperCase();

  if (!studentId || !sessionCode) {
    if (!studentId) {
      splashStudentIdInput.focus();
      return;
    }

    splashSessionCodeInput.focus();
    return;
  }

  sessionStorage.setItem(STUDENT_ID_KEY, studentId);
  sessionStorage.setItem(STUDENT_SESSION_CODE_KEY, sessionCode);
  window.location.assign('/student');
});

restoreInputs();