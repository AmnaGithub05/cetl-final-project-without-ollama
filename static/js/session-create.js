const createSessionForm = document.getElementById('create-session-form');
const sessionCodeEl = document.getElementById('session-code');
const dashboardMessage = document.getElementById('dashboard-message');

function setMessage(text, type = '') {
  dashboardMessage.textContent = text;
  dashboardMessage.className = `status-text ${type}`.trim();
}

createSessionForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    setMessage('Creating session...');
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to create session.');
    }

    sessionCodeEl.textContent = data.session_code;
    setMessage('Session created. Opening the session page...', 'success');
    window.location.assign(data.session_url);
  } catch (error) {
    setMessage(error.message, 'error');
  }
});