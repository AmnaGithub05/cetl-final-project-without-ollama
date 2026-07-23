const adminSessionsBody = document.getElementById('admin-sessions-body');
const adminQuestionsBody = document.getElementById('admin-questions-body');
const adminResponsesBody = document.getElementById('admin-responses-body');
const questionPieCharts = document.getElementById('question-pie-charts');
const questionPieStatus = document.getElementById('question-pie-status');
const questionChartModal = document.getElementById('question-chart-modal');
const questionChartModalTitle = document.getElementById('question-chart-modal-title');
const questionChartModalMeta = document.getElementById('question-chart-modal-meta');
const questionChartModalPie = document.getElementById('question-chart-modal-pie');
const questionChartModalHover = document.getElementById('question-chart-modal-hover');
const questionChartModalLegend = document.getElementById('question-chart-modal-legend');
const resetDataBtn = document.getElementById('reset-data-btn');
const resetDataMessage = document.getElementById('reset-data-message');

const MAX_PIE_CHARTS = 20;
let adminQuestionsCache = [];
let adminQuestionChartGroups = [];

function setResetMessage(text, type = '') {
  if (!resetDataMessage) {
    return;
  }

  resetDataMessage.textContent = text;
  resetDataMessage.className = `status-text ${type}`.trim();
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


function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const groups = (questions || []).map((question) => {
    const groupedResponses = responseBuckets.get(String(question.id)) || [];
    return {
      questionId: String(question.id),
      questionText: question.question_text,
      questionType: question.question_type || 'open_ended',
      sessionCode: question.session_code || '',
      responses: groupedResponses,
    };
  });

  const seenQuestionIds = new Set((questions || []).map((question) => String(question.id)));
  responseBuckets.forEach((groupedResponses, key) => {
    if (seenQuestionIds.has(key)) {
      return;
    }

    const sample = groupedResponses[0] || {};
    groups.push({
      questionId: key,
      questionText: sample.question_text || 'Question removed',
      questionType: sample.question_type || 'open_ended',
      sessionCode: sample.session_code || '',
      responses: groupedResponses,
    });
  });

  return groups.sort((left, right) => right.responses.length - left.responses.length);
}


function renderQuestionPieCards(questions, responses) {
  if (!questionPieCharts) {
    return;
  }

  const allGroups = buildQuestionResponseGroups(questions, responses);
  const groups = allGroups.slice(0, MAX_PIE_CHARTS);

  if (!groups.length) {
    questionPieCharts.innerHTML = '<div class="empty-state analytics-empty">No question responses yet.</div>';
    if (questionPieStatus) {
      questionPieStatus.textContent = '';
    }
    return;
  }

  if (questionPieStatus) {
    questionPieStatus.textContent = groups.length < allGroups.length
      ? `Showing the top ${MAX_PIE_CHARTS} questions with submitted answers.`
      : `Showing ${groups.length} question chart${groups.length === 1 ? '' : 's'}.`;
  }

  adminQuestionChartGroups = groups;

  questionPieCharts.innerHTML = groups
    .map((group, index) => {
      const buckets = getAnswerBuckets(group.responses, 5);
      const slices = buildPieSlices(buckets);
      const total = group.responses.length;
      const chartSummary = summarizeQuestion(group.questionText);

      const chartMarkup = slices.length
        ? [
            `<circle cx="120" cy="120" r="86" fill="#f8fafc" stroke="rgba(15, 118, 110, 0.12)" stroke-width="1"></circle>`,
            ...slices.map(
              (slice) => `
                <path d="${describeSlicePath(120, 120, 86, slice.startAngle, slice.endAngle)}" fill="${slice.color}" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}"></path>
              `,
            ),
            `<circle cx="120" cy="120" r="46" fill="#ffffff"></circle>`,
            `<text x="120" y="114" text-anchor="middle" fill="#172033" font-size="18" font-weight="800">${total}</text>`,
            `<text x="120" y="133" text-anchor="middle" fill="#667085" font-size="11">total answers</text>`,
          ].join('')
        : '<text x="120" y="120" text-anchor="middle" fill="#667085" font-size="14">No answers yet</text>';

      const legendMarkup = slices.length
        ? slices
            .map(
              (slice) => `
                <button type="button" class="chart-legend-item chart-legend-button" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}">
                  <span class="chart-legend-swatch" style="background:${slice.color}"></span>
                  <div>
                    <div class="chart-legend-label">${summarizeAnswer(slice.label)}</div>
                    <div class="chart-legend-meta">${slice.count} answers · ${slice.percent.toFixed(1)}%</div>
                  </div>
                </button>
              `,
            )
            .join('')
        : '<div class="empty-state">No answers submitted yet.</div>';

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
            <button class="question-chart-toggle" type="button" aria-expanded="false" data-question-chart-toggle data-question-id="${escapeHtml(group.questionId)}" data-question-title="${escapeHtml(chartSummary)}" data-question-total="${total}" data-question-type="${escapeHtml(formatQuestionType(group.questionType))}" data-question-session="${escapeHtml(group.sessionCode || '')}">
              <svg class="pie-chart" viewBox="0 0 240 240" role="img" aria-label="Pie chart for ${chartSummary}">${chartMarkup}</svg>
              <span class="question-chart-hint">Click chart to view answers</span>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}


if (questionPieCharts) {
  function updateQuestionChartPreview(label, count, percent) {
    if (!questionChartModalHover) {
      return;
    }

    questionChartModalHover.innerHTML = `
      <div class="question-chart-hover-label">${escapeHtml(label)}</div>
      <div class="question-chart-hover-meta">${count} answers · ${percent}%</div>
    `;
  }

  function findQuestionChartGroup(questionId) {
    return adminQuestionChartGroups.find((group) => String(group.questionId) === String(questionId));
  }

  function renderQuestionChartModal(group) {
    if (!questionChartModal || !questionChartModalTitle || !questionChartModalMeta || !questionChartModalLegend || !questionChartModalHover) {
      return;
    }

    const total = group.responses.length;
    const buckets = getAnswerBuckets(group.responses, 5);
    const slices = buildPieSlices(buckets);
    const chartSummary = summarizeQuestion(group.questionText);
    const chartMarkup = slices.length
      ? [
          `<circle cx="120" cy="120" r="86" fill="#f8fafc" stroke="rgba(15, 118, 110, 0.12)" stroke-width="1"></circle>`,
          ...slices.map(
            (slice) => `
              <path d="${describeSlicePath(120, 120, 86, slice.startAngle, slice.endAngle)}" fill="${slice.color}" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}"></path>
            `,
          ),
          `<circle cx="120" cy="120" r="46" fill="#ffffff"></circle>`,
          `<text x="120" y="114" text-anchor="middle" fill="#172033" font-size="18" font-weight="800">${total}</text>`,
          `<text x="120" y="133" text-anchor="middle" fill="#667085" font-size="11">total answers</text>`,
        ].join('')
      : '<text x="120" y="120" text-anchor="middle" fill="#667085" font-size="14">No answers yet</text>';

    questionChartModalTitle.textContent = chartSummary;
    questionChartModalMeta.textContent = `${formatQuestionType(group.questionType)} · ${total} answers${group.sessionCode ? ` · ${group.sessionCode}` : ''}`;
    questionChartModalHover.innerHTML = '<div class="question-chart-hover-label">Hover or click a color to see the answer.</div><div class="question-chart-hover-meta">Move over a slice or swatch to inspect it.</div>';
    if (questionChartModalPie) {
      questionChartModalPie.innerHTML = chartMarkup;
    }

    questionChartModalLegend.innerHTML = slices.length
      ? slices
          .map(
            (slice) => `
              <button type="button" class="chart-legend-item chart-legend-button" data-answer-label="${escapeHtml(slice.label)}" data-answer-count="${slice.count}" data-answer-percent="${slice.percent.toFixed(1)}" title="${escapeHtml(slice.label)}">
                <span class="chart-legend-swatch" style="background:${slice.color}"></span>
                <div>
                  <div class="chart-legend-label">${summarizeAnswer(slice.label)}</div>
                  <div class="chart-legend-meta">${slice.count} answers · ${slice.percent.toFixed(1)}%</div>
                </div>
              </button>
            `,
          )
          .join('')
      : '<div class="empty-state">No answers submitted yet.</div>';

    questionChartModal.classList.remove('hidden');
    questionChartModal.setAttribute('aria-hidden', 'false');

    const panel = questionChartModal.querySelector('.question-chart-modal-panel');
    if (panel) {
      panel.classList.remove('is-minimized');
    }

    const minimizeButton = questionChartModal.querySelector('[data-question-chart-minimize]');
    if (minimizeButton) {
      minimizeButton.setAttribute('aria-pressed', 'false');
      minimizeButton.textContent = '×';
      minimizeButton.setAttribute('aria-label', 'Minimize answers popup');
    }
  }

  function closeQuestionChartModal() {
    if (!questionChartModal) {
      return;
    }

    questionChartModal.classList.add('hidden');
    questionChartModal.setAttribute('aria-hidden', 'true');
  }

  function toggleQuestionChartMinimize() {
    if (!questionChartModal) {
      return;
    }

    const panel = questionChartModal.querySelector('.question-chart-modal-panel');
    const button = questionChartModal.querySelector('[data-question-chart-minimize]');
    if (!panel || !button) {
      return;
    }

    const isMinimized = panel.classList.toggle('is-minimized');
    if (button) {
      button.setAttribute('aria-pressed', String(isMinimized));
      button.setAttribute('aria-label', isMinimized ? 'Restore answers popup' : 'Minimize answers popup');
      button.textContent = isMinimized ? '▢' : '×';
    }
  }

  questionPieCharts.addEventListener('click', (event) => {
    const toggleButton = event.target.closest('[data-question-chart-toggle]');
    if (toggleButton) {
      const questionId = toggleButton.getAttribute('data-question-id');
      const group = findQuestionChartGroup(questionId);
      if (group) {
        renderQuestionChartModal(group);
      }
      return;
    }
  });

  if (questionChartModal) {
    questionChartModal.addEventListener('click', (event) => {
      const minimizeButton = event.target.closest('[data-question-chart-minimize]');
      if (minimizeButton) {
        toggleQuestionChartMinimize();
        return;
      }

      const closeButton = event.target.closest('[data-question-chart-close]');
      if (closeButton) {
        closeQuestionChartModal();
        return;
      }

      const answerTarget = event.target.closest('[data-answer-label]');
      if (answerTarget) {
        updateQuestionChartPreview(
          answerTarget.getAttribute('data-answer-label') || 'Blank answer',
          answerTarget.getAttribute('data-answer-count') || '0',
          answerTarget.getAttribute('data-answer-percent') || '0.0',
        );
      }
    });

    questionChartModal.addEventListener('mouseover', (event) => {
      const answerTarget = event.target.closest('[data-answer-label]');
      if (!answerTarget) {
        return;
      }

      updateQuestionChartPreview(
        answerTarget.getAttribute('data-answer-label') || 'Blank answer',
        answerTarget.getAttribute('data-answer-count') || '0',
        answerTarget.getAttribute('data-answer-percent') || '0.0',
      );
    });
  }

  questionPieCharts.addEventListener('mouseover', (event) => {
    const answerTarget = event.target.closest('[data-answer-label]');
    if (!answerTarget || !questionChartModal || questionChartModal.classList.contains('hidden')) {
      return;
    }

    updateQuestionChartPreview(
      answerTarget.getAttribute('data-answer-label') || 'Blank answer',
      answerTarget.getAttribute('data-answer-count') || '0',
      answerTarget.getAttribute('data-answer-percent') || '0.0',
    );
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && questionChartModal && !questionChartModal.classList.contains('hidden')) {
      closeQuestionChartModal();
    }
  });
}


async function resetAllData() {
  const confirmed = window.confirm('This will permanently delete all sessions, questions, and responses. Continue?');

  if (!confirmed) {
    return;
  }

  try {
    setResetMessage('Resetting data...');

    const response = await fetch('/api/instructor/admin/reset-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to reset data.');
    }

    setResetMessage(data.message || 'All data has been cleared.', 'success');
    window.location.reload();
  } catch (error) {
    setResetMessage(error.message, 'error');
  }
}

function renderSessions(sessions) {
  if (!sessions.length) {
    adminSessionsBody.innerHTML = '<tr><td colspan="5" class="empty-state">No sessions have been created yet.</td></tr>';
    return;
  }

  adminSessionsBody.innerHTML = sessions
    .map(
      (sessionRow) => `
        <tr>
          <td><a href="/instructor/sessions/${sessionRow.session_code}"><strong>${sessionRow.session_code}</strong></a></td>
          <td>${sessionRow.creator_id || 'Unknown'}</td>
          <td>${sessionRow.question_count}</td>
          <td>${sessionRow.response_count}</td>
          <td>${formatTime(sessionRow.created_at)}</td>
        </tr>
      `,
    )
    .join('');
}

function renderQuestions(questions) {
  if (!questions.length) {
    adminQuestionsBody.innerHTML = '<tr><td colspan="6" class="empty-state">No questions yet.</td></tr>';
    return;
  }

  adminQuestionsBody.innerHTML = questions
    .map(
      (question) => `
        <tr>
          <td><strong>${question.session_code}</strong></td>
          <td>${question.question_text}</td>
          <td>${formatQuestionType(question.question_type)}</td>
          <td>${question.response_count}</td>
          <td>${formatTime(question.created_at)}</td>
          <td>
            <button class="btn btn-danger btn-small" type="button" data-delete-question-id="${question.id}" data-delete-question-text="${escapeHtml(question.question_text)}" data-delete-question-session="${escapeHtml(question.session_code)}">Delete</button>
          </td>
        </tr>
      `,
    )
    .join('');
}

function renderResponses(responses) {
  if (!responses.length) {
    adminResponsesBody.innerHTML = '<tr><td colspan="7" class="empty-state">No responses yet.</td></tr>';
    renderQuestionPieCards([], []);
    return;
  }

  adminResponsesBody.innerHTML = responses
    .map(
      (response) => `
        <tr>
          <td><strong>${response.session_code}</strong></td>
          <td>${formatQuestionType(response.question_type)}</td>
          <td>${response.student_id}</td>
          <td>${response.question_text || 'Question removed'}</td>
          <td>${response.answer}</td>
          <td>${response.justification}</td>
          <td>${formatTime(response.submitted_at)}</td>
        </tr>
      `,
    )
    .join('');

  renderQuestionPieCards(adminQuestionsCache, responses);
}

async function loadAdminData() {
  const response = await fetch('/api/instructor/admin/sessions');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Unable to load admin data.');
  }

  adminQuestionsCache = data.questions || [];
  renderSessions(data.sessions || []);
  renderQuestions(adminQuestionsCache);
  renderResponses(data.responses || []);
}


async function deleteAdminQuestion(questionId, questionText, sessionCode) {
  const confirmMessage = sessionCode
    ? `Delete this question from session ${sessionCode}? This will also delete its submitted answers.`
    : 'Delete this question? This will also delete its submitted answers.';

  if (!window.confirm(`${confirmMessage}\n\n${questionText}`)) {
    return;
  }

  try {
    setResetMessage('Deleting question...');

    const response = await fetch(`/api/instructor/admin/questions/${questionId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unable to delete question.');
    }

    setResetMessage(data.message || 'Question deleted.', 'success');
    await loadAdminData();
  } catch (error) {
    setResetMessage(error.message, 'error');
  }
}


if (adminQuestionsBody) {
  adminQuestionsBody.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-question-id]');
    if (!deleteButton) {
      return;
    }

    deleteAdminQuestion(
      deleteButton.getAttribute('data-delete-question-id'),
      deleteButton.getAttribute('data-delete-question-text') || 'Question',
      deleteButton.getAttribute('data-delete-question-session') || '',
    );
  });
}

loadAdminData().catch((error) => {
  adminSessionsBody.innerHTML = `<tr><td colspan="5" class="empty-state">${error.message}</td></tr>`;
  adminQuestionsBody.innerHTML = `<tr><td colspan="6" class="empty-state">${error.message}</td></tr>`;
  adminResponsesBody.innerHTML = `<tr><td colspan="6" class="empty-state">${error.message}</td></tr>`;
  if (questionPieCharts) {
    questionPieCharts.innerHTML = `<div class="empty-state analytics-empty">${error.message}</div>`;
  }
  if (questionPieStatus) {
    questionPieStatus.textContent = '';
  }
});

if (resetDataBtn) {
  resetDataBtn.addEventListener('click', resetAllData);
}
