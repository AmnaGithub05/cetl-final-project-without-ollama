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
const compareMisconceptionsBtn = document.getElementById('compare-misconceptions-btn');
const comparisonMessage = document.getElementById('comparison-message');

let refreshTimer = null;
let sessionQuestionChartGroups = [];
let currentQuestionIdForAnswerKey = null;
let selectedMisconceptionCode = null;
let selectedMisconceptionQuestionId = null;
let selectedMisconceptionScrollTop = 0;

function renderModelComparison(responses) {
  const comparisonRows = (responses || []).flatMap((response) =>
    (response.comparisons || []).map((comparison) => ({ ...comparison, response })),
  );
  const providers = ['ollama', 'claude', 'gemini'];
  const latestByProvider = new Map();
  comparisonRows.forEach((row) => {
    if (!latestByProvider.has(row.provider)) {
      latestByProvider.set(row.provider, row);
    }
  });
  const labels = { ollama: 'Ollama', claude: 'Claude', gemini: 'Gemini' };
  const html = providers.map((provider) => {
    const result = latestByProvider.get(provider);
    if (!result) {
      return `<div class="comparison-result"><strong>${labels[provider]}</strong><span>Not run</span></div>`;
    }
    if (result.error_text) {
      const errorText = provider === 'ollama'
        ? 'This service is not available.'
        : result.error_text;
      return `<div class="comparison-result"><strong>${labels[provider]}</strong><span class="status-text error">${escapeHtml(errorText)}</span></div>`;
    }
    const confidence = result.confidence_score == null ? '—' : `${Math.round(result.confidence_score * 100)}%`;
    return `<div class="comparison-result"><strong>${labels[provider]}</strong><span>${escapeHtml(result.misconception_code || 'No misconception')}</span><small>${escapeHtml(result.severity || '—')} · ${confidence}</small><p>${escapeHtml(result.feedback_text || '')}</p></div>`;
  }).join('');
  const comparisonPanel = document.createElement('div');
  comparisonPanel.className = 'model-comparison-grid';
  comparisonPanel.innerHTML = html;
  const oldPanel = misconceptionAnalytics.querySelector('.model-comparison-grid');
  if (oldPanel) oldPanel.remove();
  misconceptionAnalytics.prepend(comparisonPanel);
}

async function readJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.ok
        ? 'The server returned an unexpected response.'
        : `The server returned an error (${response.status}).`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`The server returned invalid JSON (${response.status}).`);
  }
}

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
async function runMisconceptionComparison() {
  if (!compareMisconceptionsBtn) return;
  compareMisconceptionsBtn.disabled = true;
  comparisonMessage.textContent = 'Comparing responses with all three models. This can take a moment...';
  comparisonMessage.className = 'status-text';
  try {
    const response = await fetch(`/api/instructor/sessions/${sessionCode}/compare-misconceptions`, { method: 'POST' });
    const data = await readJsonResponse(response);
    if (!response.ok) throw new Error(data.error || 'Comparison failed.');
    comparisonMessage.textContent = `Comparison complete for ${data.responses} response${data.responses === 1 ? '' : 's'} (${data.errors} provider error${data.errors === 1 ? '' : 's'}).`;
    comparisonMessage.className = `status-text ${data.errors ? 'error' : 'success'}`.trim();
    await loadMisconceptionAnalytics();
  } catch (error) {
    comparisonMessage.textContent = error.message;
    comparisonMessage.className = 'status-text error';
  } finally {
    compareMisconceptionsBtn.disabled = false;
  }
}

async function loadMisconceptionAnalytics() {
  try {
    const existingResponseList = misconceptionAnalytics.querySelector('.misconception-response-list');
    if (existingResponseList) {
      selectedMisconceptionScrollTop = existingResponseList.scrollTop;
    }

    const responsesResponse = await fetch(`/api/instructor/sessions/${sessionCode}/responses`);
    if (!responsesResponse.ok) throw new Error('Failed to load responses');
    
    const responsesData = await readJsonResponse(responsesResponse);
    const responses = responsesData.responses || [];
    const questions = responsesData.questions || [];
    const misconceptionsMap = new Map();
    const matrix = new Map();
    let totalDetected = 0;

    responses.forEach((response) => {
      if (response.misconception_code) {
        totalDetected++;
        const key = response.misconception_code;
        if (!misconceptionsMap.has(key)) {
          misconceptionsMap.set(key, {
            code: response.misconception_code,
            severity: response.misconception_severity || 'UNKNOWN',
            count: 0,
            responses: [],
          });
        }

        const item = misconceptionsMap.get(key);
        item.count++;
        item.responses.push(response);

        if (!matrix.has(response.question_id)) {
          matrix.set(response.question_id, new Map());
        }
        const questionCounts = matrix.get(response.question_id);
        questionCounts.set(key, (questionCounts.get(key) || 0) + 1);
      }
    });

    renderModelComparison(responses);

    // Render analytics
    if (misconceptionsMap.size === 0) {
      misconceptionAnalytics.innerHTML = '<p class="empty-state">No misconceptions detected yet.</p>';
      renderModelComparison(responses);
      return;
    }

    const misconceptions = Array.from(misconceptionsMap.values())
      .sort((a, b) => b.count - a.count);
    const misconceptionCodes = misconceptions.map((item) => item.code);
    const questionRows = questions.filter((question) => matrix.has(question.id));
    const maxCount = Math.max(...misconceptions.map((item) => item.count));

    const html = `
      <div class="misconception-summary">
        <div class="summary-stat">
          <span class="stat-label">Total Misconceptions Detected</span>
          <span class="stat-value">${totalDetected}</span>
        </div>
        <div class="summary-stat">
          <span class="stat-label">Unique Types</span>
          <button type="button" class="summary-stat-button misconception-detail-btn" data-misconception-code="__all__">${misconceptions.length}</button>
        </div>
        <div class="summary-stat">
          <span class="stat-label">Questions Affected</span>
          <span class="stat-value">${questionRows.length}</span>
        </div>
      </div>
      <div class="misconception-heatmap-wrap">
        <table class="misconception-heatmap">
          <caption>Detected misconceptions by question. Darker cells indicate more detections.</caption>
          <thead>
            <tr>
              <th scope="col">Question</th>
              ${misconceptions.map((item) => `<th scope="col" title="${escapeHtml(item.severity)} severity"><button type="button" class="misconception-detail-btn" data-misconception-code="${escapeHtml(item.code)}">${escapeHtml(item.code)}</button></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${questionRows.map((question, questionIndex) => {
              const questionCounts = matrix.get(question.id);
              return `
                <tr>
                  <th scope="row" title="${escapeHtml(question.question_text)}">
                    <span class="heatmap-question-number">Q${questionRows.length - questionIndex}</span>
                    <span class="heatmap-question-text">${escapeHtml(question.question_text)}</span>
                  </th>
                  ${misconceptionCodes.map((code) => {
                    const count = questionCounts.get(code) || 0;
                    const intensity = count ? Math.max(1, Math.ceil((count / maxCount) * 5)) : 0;
                    return `<td class="heat-cell heat-${intensity}" title="${count} detection${count === 1 ? '' : 's'} for ${escapeHtml(code)}">${count ? `<button type="button" class="misconception-detail-btn heat-cell-button" data-misconception-code="${escapeHtml(code)}" data-question-id="${question.id}">${count}</button>` : '-'}</td>`;
                  }).join('')}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div id="misconception-details" class="misconception-details" aria-live="polite">
        <p class="empty-state">Select a misconception code or heatmap cell to inspect Ollama's findings.</p>
      </div>
    `;

    misconceptionAnalytics.innerHTML = html;
    renderModelComparison(responses);
    misconceptionAnalytics.querySelectorAll('.misconception-detail-btn').forEach((button) => {
      const showDetails = (shouldScroll = true) => {
        const selectedCode = button.dataset.misconceptionCode;
        const selectedQuestionId = button.dataset.questionId;
        selectedMisconceptionCode = selectedCode;
        selectedMisconceptionQuestionId = selectedQuestionId || null;
        const selected = selectedCode === '__all__'
          ? {
            code: 'All unique types',
            severity: 'Multiple',
            responses: misconceptions.flatMap((item) => item.responses),
          }
          : misconceptionsMap.get(selectedCode);
        const selectedResponses = selected.responses.filter((response) => {
          const matchesQuestion = !selectedQuestionId || String(response.question_id) === selectedQuestionId;
          return matchesQuestion;
        });
        const details = misconceptionAnalytics.querySelector('#misconception-details');
        details.innerHTML = `
          <div class="misconception-details-head">
            <div>
              <p class="section-label">Theoretical analysis</p>
              <h4>${escapeHtml(selected.code)}</h4>
            </div>
            <span class="severity-badge">${escapeHtml(selected.severity)}</span>
          </div>
          <p class="misconception-details-count">${selectedResponses.length} affected response${selectedResponses.length === 1 ? '' : 's'}</p>
          <div class="misconception-response-list">
            ${selectedResponses.map((response) => `
              <article class="misconception-response">
                <p><strong>${escapeHtml(response.student_id)}</strong> · ${escapeHtml(response.question_text || 'Question removed')}</p>
                <p><strong>Answer:</strong> ${escapeHtml(response.answer)}</p>
                ${response.misconception_feedback ? `<p class="misconception-feedback">${escapeHtml(response.misconception_feedback)}</p>` : ''}
              </article>
            `).join('')}
          </div>
        `;
        const responseList = details.querySelector('.misconception-response-list');
        responseList.scrollTop = shouldScroll ? 0 : selectedMisconceptionScrollTop;
        if (shouldScroll) {
          details.scrollIntoView({ behavior: 'auto', block: 'start' });
        }
      };
      button.addEventListener('click', showDetails);

      if (
        button.dataset.misconceptionCode === selectedMisconceptionCode
        && (button.dataset.questionId || null) === selectedMisconceptionQuestionId
      ) {
        showDetails(false);
      }
    });
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
  if (!responsesTableBody) {
    return;
  }

  if (!responses.length) {
    responsesTableBody.innerHTML = '<tr><td colspan="7" class="empty-state">No responses yet. Share the session code with students.</td></tr>';
    return;
  }

  responsesTableBody.innerHTML = '';
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
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Server returned an unexpected response (${response.status}). Please check the Render logs.`);
    }

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
if (compareMisconceptionsBtn) {
  compareMisconceptionsBtn.addEventListener('click', runMisconceptionComparison);
}

// Answer Key Modal Event Listeners
answerKeyForm.addEventListener('submit', saveAnswerKey);

// Close answer key modal on backdrop click
document.querySelectorAll('[data-answer-key-close]').forEach((element) => {
  element.addEventListener('click', closeAnswerKeyModal);
});

setQuestionTypeUi(questionTypeInput.value);
loadSessionData();
startAutoRefresh();