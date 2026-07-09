const instructorAccessForm = document.getElementById('instructor-access-form');
const instructorIdInput = document.getElementById('instructor-id-input');

const INSTRUCTOR_ID_KEY = 'microcheck-instructor-id';

const storedInstructorId = sessionStorage.getItem(INSTRUCTOR_ID_KEY);
if (storedInstructorId) {
  instructorIdInput.value = storedInstructorId;
}

instructorAccessForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const instructorId = instructorIdInput.value.trim();
  if (!instructorId) {
    instructorIdInput.focus();
    return;
  }

  fetch('/instructor/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructor_id: instructorId }),
  })
    .then(async (response) => {
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Unable to sign in.');
      }

      sessionStorage.setItem(INSTRUCTOR_ID_KEY, instructorId.toUpperCase());
      window.location.assign(data.redirect_url);
    })
    .catch((error) => {
      setTimeout(() => {
        instructorIdInput.focus();
      }, 0);
      window.alert(error.message);
    });
});