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
const sessionQuestionPieCharts = document.getElementById('session-question-pie-charts');
const sessionQuestionPieStatus = document.getElementById('session-question-pie-status');
const sessionQuestionChartModal = document.getElementById('session-question-chart-modal');
const sessionQuestionChartModalTitle = document.getElementById('session-question-chart-modal-title');
const sessionQuestionChartModalMeta = document.getElementById('session-question-chart-modal-meta');
const sessionQuestionChartModalPie = document.getElementById('session-question-chart-modal-pie');
const sessionQuestionChartModalHover = document.getElementById('session-question-chart-modal-hover');
const sessionQuestionChartModalLegend = document.getElementById('session-question-chart-modal-legend');
const refreshBtn = document.getElementById('refresh-btn');

// Answer Key Modal Elements
const answerKeyModal = document.getElementById('answer-key-modal');
const answerKeyForm = document.getElementById('answer-key-form');
const answerKeyTextarea = document.getElementById('answer-key-textarea');
const answerKeyModalTitle = document.getElementById('answer-key-modal-title');
const answerKeyModalQuestion = document.getElementById('answer-key-modal-question');
const answerKeyMessage = document.getElementById('answer-key-message');
const misconceptionAnalytics = document.getElementById('misconception-analytics');

let refreshTimer = null;
let sessionQuestionChartGroups = [];
let currentQuestionIdForAnswerKey = null;

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


function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


function normalizeAnswer(answer) {
  return String(answer || '').trim().replace(/\s+/g, ' ');
}


function summarizeAnswer(answer, maxLength = 42) {
  const normalized = normalizeAnswer(answer);
  if (!normalized) {
    return 'Blank answer';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}


function summarizeQuestion(questionText, maxLength = 90) {
  const normalized = String(questionText || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return 'Question removed';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}


function getAnswerBuckets(responses, maxBuckets = 5) {
  const counts = new Map();

  (responses || []).forEach((response) => {
    const answer = normalizeAnswer(response.answer);
    const bucket = answer || 'Blank answer';
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]);
  if (!sorted.length) {
    return [];
  }

  if (sorted.length <= maxBuckets) {
    return sorted.map(([label, count]) => ({ label, count }));
  }

  const topBuckets = sorted.slice(0, maxBuckets - 1).map(([label, count]) => ({ label, count }));
  const otherCount = sorted.slice(maxBuckets - 1).reduce((total, [, count]) => total + count, 0);
  return [...topBuckets, { label: 'Other', count: otherCount }];
}


function buildPieSlices(buckets) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  if (!total) {
    return [];
  }

  const palette = ['#0f766e', '#f97316', '#2563eb', '#8b5cf6', '#ef4444'];
  let cumulative = 0;

  return buckets.map((bucket, index) => {
    const startAngle = (cumulative / total) * Math.PI * 2 - Math.PI / 2;
    cumulative += bucket.count;
    const endAngle = (cumulative / total) * Math.PI * 2 - Math.PI / 2;

    return {
      ...bucket,
      startAngle,
      endAngle,
      percent: (bucket.count / total) * 100,
      color: palette[index % palette.length],
    };
  });
}


function polarToCartesian(centerX, centerY, radius, angle) {
  return {
    x: centerX + radius * Math.cos(angle),
    y: centerY + radius * Math.sin(angle),
  };
}


function describeSlicePath(centerX, centerY, radius, startAngle, endAngle) {
  const start = polarToCartesian(centerX, centerY, radius, endAngle);
  const end = polarToCartesian(centerX, centerY, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= Math.PI ? '0' : '1';

  return [
    `M ${centerX} ${centerY}`,
    `L ${end.x} ${end.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${start.x} ${start.y}`,
    'Z',
  ].join(' ');
}


function buildQuestionResponseGroups(questions, responses) {
  const responseBuckets = new Map();

  (responses || []).forEach((response) => {
    const questionId = response.question_id != null ? String(response.question_id) : '';
    const key = questionId || `text:${normalizeAnswer(response.question_text) || 'removed'}`;
    const existing = responseBuckets.get(key) || [];
    existing.push(response);
    responseBuckets.set(key, existing);
  });

  return (questions || [])
    .map((question) => ({
      questionId: String(question.id),
      questionText: question.question_text,
      questionType: question.question_type || 'open_ended',
      sessionCode: question.session_code || '',
      responses: responseBuckets.get(String(question.id)) || [],
    }))
    .sort((left, right) => right.responses.length - left.responses.length);
}


function renderSessionQuestionCharts(questions, responses) {
  if (!sessionQuestionPieCharts) {
    return;
  }

  const allGroups = buildQuestionResponseGroups(questions, responses);
  const groups = allGroups.slice(0, 20);
  sessionQuestionChartGroups = groups;

  if (!groups.length) {
    sessionQuestionPieCharts.innerHTML = '<div class="empty-state analytics-empty">No question responses yet.</div>';
    if (sessionQuestionPieStatus) {
      sessionQuestionPieStatus.textContent = '';
    }
    return;
  }

  if (sessionQuestionPieStatus) {
    sessionQuestionPieStatus.textContent = groups.length < allGroups.length
      ? 'Showing the top 20 questions with submitted answers.'
      : `Showing ${groups.length} question chart${groups.length === 1 ? '' : 's'}.`;
  }

  sessionQuestionPieCharts.innerHTML = groups
    .map((group, index) => {
      const buckets = getAnswerBuckets(group.responses, 5);
      const slices = buildPieSlices(buckets);
      const total = group.responses.length;
      const chartSummary = summarizeQuestion(group.questionText);

      const chartMarkup = slices.length
        ? [
            `<circle cx="120" cy="120" r="86" fill="#f8fafc" stroke="rgba(15, 118, 110, 0.12)" stroke-width="1"></circle>`,
            ...slices.map((slice) => `
              <path d="${describeSlicePath(120, 120, 86, slice.startAngle, slice.endAngle)}" fill="${slice.color}" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}"></path>
            `),
            `<circle cx="120" cy="120" r="46" fill="#ffffff"></circle>`,
            `<text x="120" y="114" text-anchor="middle" fill="#172033" font-size="18" font-weight="800">${total}</text>`,
            `<text x="120" y="133" text-anchor="middle" fill="#667085" font-size="11">total answers</text>`,
          ].join('')
        : '<text x="120" y="120" text-anchor="middle" fill="#667085" font-size="14">No answers yet</text>';

      return `
        <article class="card panel question-chart-card">
          <div class="question-chart-head">
            <div>
              <p class="section-label">Question ${index + 1}</p>
              <h3>${chartSummary}</h3>
              <p class="question-chart-meta">${formatQuestionType(group.questionType)} · ${total} answers${group.sessionCode ? ` · ${group.sessionCode}` : ''}</p>
            </div>
          </div>
          <div class="question-chart-layout">
            <button class="question-chart-toggle" type="button" data-session-question-chart-toggle data-question-id="${escapeHtml(group.questionId)}" data-question-title="${escapeHtml(chartSummary)}">
              <svg class="pie-chart" viewBox="0 0 240 240" role="img" aria-label="Pie chart for ${chartSummary}">${chartMarkup}</svg>
              <span class="question-chart-hint">Click chart to view answers</span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}


function renderSessionQuestionChartModal(group) {
  if (!sessionQuestionChartModal || !sessionQuestionChartModalTitle || !sessionQuestionChartModalMeta || !sessionQuestionChartModalPie || !sessionQuestionChartModalHover || !sessionQuestionChartModalLegend) {
    return;
  }

  const total = group.responses.length;
  const buckets = getAnswerBuckets(group.responses, 5);
  const slices = buildPieSlices(buckets);
  const chartSummary = summarizeQuestion(group.questionText);

  sessionQuestionChartModalTitle.textContent = chartSummary;
  sessionQuestionChartModalMeta.textContent = `${formatQuestionType(group.questionType)} · ${total} answers${group.sessionCode ? ` · ${group.sessionCode}` : ''}`;
  sessionQuestionChartModalPie.innerHTML = slices.length
    ? [
        `<circle cx="120" cy="120" r="86" fill="#f8fafc" stroke="rgba(15, 118, 110, 0.12)" stroke-width="1"></circle>`,
        ...slices.map((slice) => `
          <path d="${describeSlicePath(120, 120, 86, slice.startAngle, slice.endAngle)}" fill="${slice.color}" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}"></path>
        `),
        `<circle cx="120" cy="120" r="46" fill="#ffffff"></circle>`,
        `<text x="120" y="114" text-anchor="middle" fill="#172033" font-size="18" font-weight="800">${total}</text>`,
        `<text x="120" y="133" text-anchor="middle" fill="#667085" font-size="11">total answers</text>`,
      ].join('')
    : '<text x="120" y="120" text-anchor="middle" fill="#667085" font-size="14">No answers yet</text>';

  sessionQuestionChartModalHover.innerHTML = '<div class="question-chart-hover-label">Hover or click a color to see the answer.</div><div class="question-chart-hover-meta">Move over a slice or swatch to inspect it.</div>';
  sessionQuestionChartModalLegend.innerHTML = slices.length
    ? slices.map((slice) => `
        <button type="button" class="chart-legend-item chart-legend-button" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}">
          <span class="chart-legend-swatch" style="background:${slice.color}"></span>
          <div>
            <div class="chart-legend-label">${summarizeAnswer(slice.label)}</div>
            <div class="chart-legend-meta">${slice.count} answers · ${slice.percent.toFixed(1)}%</div>
          </div>
        </button>
      `).join('')
    : '<div class="empty-state">No answers submitted yet.</div>';

  sessionQuestionChartModal.classList.remove('hidden');
  sessionQuestionChartModal.setAttribute('aria-hidden', 'false');
}


function closeSessionQuestionChartModal() {
  if (!sessionQuestionChartModal) {
    return;
  }

  sessionQuestionChartModal.classList.add('hidden');
  sessionQuestionChartModal.setAttribute('aria-hidden', 'true');
}


function toggleSessionQuestionChartMinimize() {
  const panel = sessionQuestionChartModal?.querySelector('.question-chart-modal-panel');
  const button = sessionQuestionChartModal?.querySelector('[data-session-question-chart-minimize]');
  if (!panel || !button) {
    return;
  }

  const isMinimized = panel.classList.toggle('is-minimized');
  button.setAttribute('aria-pressed', String(isMinimized));
  button.setAttribute('aria-label', isMinimized ? 'Restore answers popup' : 'Minimize answers popup');
  button.textContent = isMinimized ? '▢' : '×';
}


if (sessionQuestionPieCharts) {
  sessionQuestionPieCharts.addEventListener('click', (event) => {
    const toggleButton = event.target.closest('[data-session-question-chart-toggle]');
    if (toggleButton) {
      const questionId = toggleButton.getAttribute('data-question-id');
      const group = sessionQuestionChartGroups.find((item) => String(item.questionId) === String(questionId));
      if (group) {
        renderSessionQuestionChartModal(group);
      }
    }
  });
}

if (sessionQuestionChartModal) {
  sessionQuestionChartModal.addEventListener('click', (event) => {
    if (event.target.closest('[data-session-question-chart-close]')) {
      closeSessionQuestionChartModal();
      return;
    }

    if (event.target.closest('[data-session-question-chart-minimize]')) {
      toggleSessionQuestionChartMinimize();
      return;
    }

    const answerTarget = event.target.closest('[data-answer-label]');
    if (answerTarget) {
      sessionQuestionChartModalHover.innerHTML = `
        <div class="question-chart-hover-label">${escapeHtml(answerTarget.getAttribute('data-answer-label') || 'Blank answer')}</div>
        <div class="question-chart-hover-meta">${answerTarget.getAttribute('data-answer-count') || '0'} answers · ${answerTarget.getAttribute('data-answer-percent') || '0.0'}%</div>
      `;
    }
  });

  sessionQuestionChartModal.addEventListener('mouseover', (event) => {
    const answerTarget = event.target.closest('[data-answer-label]');
    if (!answerTarget) {
      return;
    }

    sessionQuestionChartModalHover.innerHTML = `
      <div class="question-chart-hover-label">${escapeHtml(answerTarget.getAttribute('data-answer-label') || 'Blank answer')}</div>
      <div class="question-chart-hover-meta">${answerTarget.getAttribute('data-answer-count') || '0'} answers · ${answerTarget.getAttribute('data-answer-percent') || '0.0'}%</div>
    `;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sessionQuestionChartModal && !sessionQuestionChartModal.classList.contains('hidden')) {
      closeSessionQuestionChartModal();
    }
  });
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

// Answer Key Functions
function openAnswerKeyModal(questionId, questionText) {
  currentQuestionIdForAnswerKey = questionId;
  answerKeyModalQuestion.textContent = questionText;
  answerKeyTextarea.value = '';
  answerKeyMessage.textContent = '';
  answerKeyMessage.className = 'status-text';
  answerKeyModal.classList.remove('hidden');
  answerKeyModal.setAttribute('aria-hidden', 'false');
}

function closeAnswerKeyModal() {
  answerKeyModal.classList.add('hidden');
  answerKeyModal.setAttribute('aria-hidden', 'true');
  currentQuestionIdForAnswerKey = null;
}

async function saveAnswerKey(event) {
  event.preventDefault();
  
  if (!currentQuestionIdForAnswerKey) {
    answerKeyMessage.textContent = 'Error: No question selected.';
    answerKeyMessage.className = 'status-text error';
    return;
  }
  
  const answerKey = answerKeyTextarea.value.trim();
  if (!answerKey) {
    answerKeyMessage.textContent = 'Please enter an answer key.';
    answerKeyMessage.className = 'status-text error';
    return;
  }
  
  try {
    const response = await fetch(`/api/instructor/questions/${currentQuestionIdForAnswerKey}/answer-key`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_key: answerKey }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save answer key');
    }
    
    answerKeyMessage.textContent = '✓ Answer key saved successfully!';
    answerKeyMessage.className = 'status-text success';
    setTimeout(closeAnswerKeyModal, 1500);
  } catch (error) {
    answerKeyMessage.textContent = `Error: ${error.message}`;
    answerKeyMessage.className = 'status-text error';
  }
}

// Misconception Analytics Functions
async function loadMisconceptionAnalytics() {
  try {
    const responsesResponse = await fetch(`/api/instructor/sessions/${sessionCode}/responses`);
    if (!responsesResponse.ok) throw new Error('Failed to load responses');
    
    const responsesData = await responsesResponse.json();
    const responses = responsesData.responses || [];
    
    // Group misconceptions by type
    const misconceptionsMap = new Map();
    let totalDetected = 0;
    
    responses.forEach((response) => {
      if (response.misconception_code) {
        totalDetected++;
        const key = response.misconception_code;
        if (!misconceptionsMap.has(key)) {
          misconceptionsMap.set(key, {
            code: response.misconception_code,
            severity: response.misconception_severity || 'UNKNOWN',
            feedback: response.misconception_feedback || 'No feedback',
            count: 0,
            students: new Set(),
          });
        }
        const item = misconceptionsMap.get(key);
        item.count++;
        item.students.add(response.student_id);
      }
    });
    
    // Render analytics
    if (misconceptionsMap.size === 0) {
      misconceptionAnalytics.innerHTML = '<p class="empty-state">No misconceptions detected yet.</p>';
      return;
    }
    
    const misconceptions = Array.from(misconceptionsMap.values())
      .sort((a, b) => b.count - a.count);
    
    const html = `
      <div class="misconception-summary">
        <div class="summary-stat">
          <span class="stat-label">Total Misconceptions Detected</span>
          <span class="stat-value">${totalDetected}</span>
        </div>
        <div class="summary-stat">
          <span class="stat-label">Unique Types</span>
          <span class="stat-value">${misconceptions.length}</span>
        </div>
      </div>
      <div class="misconception-list">
        ${misconceptions
          .map(
            (m) => `
          <div class="misconception-item severity-${m.severity.toLowerCase()}">
            <div class="misconception-header">
              <strong>${m.code}</strong>
              <span class="severity-badge">${m.severity}</span>
            </div>
            <p class="misconception-stats">${m.count} detection${m.count !== 1 ? 's' : ''} • ${m.students.size} student${m.students.size !== 1 ? 's' : ''}</p>
            <p class="misconception-feedback">${escapeHtml(m.feedback.substring(0, 150))}${m.feedback.length > 150 ? '...' : ''}</p>
          </div>
        `,
          )
          .join('')}
      </div>
    `;
    
    misconceptionAnalytics.innerHTML = html;
  } catch (error) {
    misconceptionAnalytics.innerHTML = `<p class="status-text error">Error loading misconceptions: ${error.message}</p>`;
  }
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
            ${question.answer_key ? `<p class="question-list-meta answer-key-badge">✓ Answer key set</p>` : ''}
            ${question.question_type === 'mcq' && normalizeOptions(question.options).length ? `
              <ul class="mcq-option-list question-list-options">
                ${normalizeOptions(question.options).map((option) => `<li>${option}</li>`).join('')}
              </ul>
            ` : ''}
          </div>
          <div class="question-list-actions">
            <button class="btn btn-sm btn-ghost answer-key-btn" data-question-id="${question.id}" data-question-text="${escapeHtml(question.question_text)}">
              ${question.answer_key ? '✎ Edit' : '+ Add'} Answer Key
            </button>
            <div class="question-list-count">
              <strong>${question.response_count}</strong>
              <span>responses</span>
            </div>
          </div>
        </article>
      `,
    )
    .join('');
    
  // Add event listeners to answer key buttons
  document.querySelectorAll('.answer-key-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.questionId;
      const qText = btn.dataset.questionText;
      openAnswerKeyModal(qId, qText);
    });
  });
}

function renderResponses(responses) {
  if (!responses.length) {
    responsesTableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No responses yet. Share the session code with students.</td></tr>';
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
          <td>${response.misconception_code ? `<span class="misconception-tag">${response.misconception_code}</span>` : '-'}</td>
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
    renderSessionQuestionCharts(questionsData.questions, responsesData.responses);
    loadMisconceptionAnalytics();
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

// Answer Key Modal Event Listeners
answerKeyForm.addEventListener('submit', saveAnswerKey);

// Close answer key modal on backdrop click
document.querySelectorAll('[data-answer-key-close]').forEach((element) => {
  element.addEventListener('click', closeAnswerKeyModal);
});

setQuestionTypeUi(questionTypeInput.value);
loadSessionData();
startAutoRefresh();