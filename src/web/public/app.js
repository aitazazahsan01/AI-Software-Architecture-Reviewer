const MERMAID_CDN_URL = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

const STAGES = [
  { id: 'config', label: 'Checking configuration' },
  { id: 'scan', label: 'Scanning repository' },
  { id: 'analyze', label: 'Analyzing dependencies & APIs' },
  { id: 'embed', label: 'Embedding code chunks' },
  { id: 'retrieve', label: 'Retrieving relevant context' },
  { id: 'llm', label: 'Generating impact report (Gemini)' },
  { id: 'diagrams', label: 'Generating diagrams' },
  { id: 'report', label: 'Writing report' },
  { id: 'done', label: 'Done' },
];

const form = document.getElementById('analyze-form');
const repoInput = document.getElementById('repo-input');
const proposalInput = document.getElementById('proposal-input');
const outInput = document.getElementById('out-input');
const submitBtn = document.getElementById('submit-btn');
const formError = document.getElementById('form-error');

const progressEl = document.getElementById('progress');
const stepsEl = document.getElementById('progress-steps');
const logEl = document.getElementById('progress-log');

const emptyState = document.getElementById('empty-state');
const errorBanner = document.getElementById('error-banner');
const resultsEl = document.getElementById('results');

let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import(MERMAID_CDN_URL).then((mod) => {
      const mermaid = mod.default;
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', securityLevel: 'strict' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

function renderSteps() {
  stepsEl.innerHTML = '';
  for (const stage of STAGES) {
    const li = document.createElement('li');
    li.className = 'step';
    li.dataset.stage = stage.id;
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    const label = document.createElement('span');
    label.className = 'step-label';
    label.textContent = stage.label;
    li.append(dot, label);
    stepsEl.append(li);
  }
}

function setStageActive(stageId) {
  const index = STAGES.findIndex((s) => s.id === stageId);
  if (index === -1) return;
  [...stepsEl.children].forEach((li, i) => {
    li.classList.remove('is-active', 'is-done', 'is-error');
    if (i < index) li.classList.add('is-done');
    else if (i === index) li.classList.add('is-active');
  });
}

function markAllDone() {
  [...stepsEl.children].forEach((li) => {
    li.classList.remove('is-active', 'is-error');
    li.classList.add('is-done');
  });
}

function markActiveAsError() {
  const active = stepsEl.querySelector('.step.is-active');
  if (active) {
    active.classList.remove('is-active');
    active.classList.add('is-error');
  }
}

function appendLog(message) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent += `[${time}] ${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle('is-loading', isLoading);
}

function clearChildren(el) {
  el.innerHTML = '';
}

function severityBadge(severity) {
  const span = document.createElement('span');
  const level = ['low', 'medium', 'high'].includes(severity) ? severity : 'medium';
  span.className = `badge badge-${level}`;
  span.textContent = level;
  return span;
}

function fillTable(bodyEl, rows, columns) {
  clearChildren(bodyEl);
  for (const row of rows || []) {
    const tr = document.createElement('tr');
    for (const col of columns) {
      const td = document.createElement('td');
      td.textContent = row[col] ?? '';
      tr.append(td);
    }
    bodyEl.append(tr);
  }
}

function fillRiskList(listEl, items, textKey) {
  clearChildren(listEl);
  for (const item of items || []) {
    const li = document.createElement('li');
    li.className = 'risk-item';

    const head = document.createElement('div');
    head.className = 'risk-item-head';
    head.append(severityBadge(item.severity));
    const text = document.createElement('span');
    text.className = 'risk-text';
    text.textContent = item[textKey] ?? '';
    head.append(text);

    const mitigation = document.createElement('p');
    mitigation.className = 'risk-mitigation';
    mitigation.textContent = item.mitigation ? `Mitigation: ${item.mitigation}` : '';

    li.append(head, mitigation);
    listEl.append(li);
  }
}

function fillSteps(listEl, steps) {
  clearChildren(listEl);
  for (const step of steps || []) {
    const li = document.createElement('li');
    li.textContent = step;
    listEl.append(li);
  }
}

async function renderDiagrams(diagrams) {
  const container = document.getElementById('diagrams');
  clearChildren(container);
  if (!diagrams) return;

  const entries = [
    ['Current architecture', diagrams.currentArchitecture],
    ['Proposed architecture', diagrams.proposedArchitecture],
    ['Sequence flow', diagrams.sequenceFlow],
    ['Data model changes', diagrams.dataModelDiagram],
  ].filter(([, source]) => !!source);

  entries.forEach(([label, source], i) => {
    const details = document.createElement('details');
    if (i === 0) details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = label;
    const body = document.createElement('div');
    body.className = 'diagram-body';
    const pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.textContent = source;
    body.append(pre);
    details.append(summary, body);
    container.append(details);
  });

  if (entries.length > 0) {
    const mermaid = await loadMermaid();
    await mermaid.run({ querySelector: '#diagrams pre.mermaid' });
  }
}

function renderResults(payload) {
  const { result, mdPath, htmlPath } = payload;
  const report = result.report;

  document.getElementById('summary-text').textContent = report.summary || '';
  const paths = document.getElementById('source-paths');
  paths.textContent = mdPath || htmlPath ? `Also written to: ${mdPath || ''}${mdPath && htmlPath ? ' / ' : ''}${htmlPath || ''}` : '';

  fillTable(document.getElementById('components-body'), report.affectedComponents, ['name', 'reason']);
  fillTable(document.getElementById('apis-body'), report.affectedApis, ['endpoint', 'impact']);
  fillTable(document.getElementById('db-body'), report.databaseChanges, ['description', 'migrationNotes']);
  fillTable(document.getElementById('new-components-body'), report.newComponents, ['name', 'purpose']);

  fillRiskList(document.getElementById('scalability-list'), report.scalabilityRisks, 'risk');
  fillRiskList(document.getElementById('security-list'), report.securityConcerns, 'concern');

  fillSteps(document.getElementById('steps-list'), report.recommendedSteps);

  renderDiagrams(result.diagrams);

  emptyState.hidden = true;
  errorBanner.hidden = true;
  resultsEl.hidden = false;
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  emptyState.hidden = true;
  resultsEl.hidden = true;
}

function resetBeforeRun() {
  formError.hidden = true;
  errorBanner.hidden = true;
  resultsEl.hidden = true;
  emptyState.hidden = true;
  logEl.textContent = '';
  progressEl.hidden = false;
  renderSteps();
}

let activeSource = null;

form.addEventListener('submit', (evt) => {
  evt.preventDefault();

  const repo = repoInput.value.trim();
  const proposal = proposalInput.value.trim();
  const out = outInput.value.trim();

  if (!repo || !proposal) {
    formError.textContent = 'Please fill in both the repository path and the proposed change.';
    formError.hidden = false;
    return;
  }

  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }

  resetBeforeRun();
  setLoading(true);

  const params = new URLSearchParams({ repo, proposal });
  if (out) params.set('out', out);

  const source = new EventSource(`/api/analyze?${params.toString()}`);
  activeSource = source;

  source.addEventListener('progress', (evt) => {
    const data = JSON.parse(evt.data);
    setStageActive(data.stage);
    appendLog(data.message);
  });

  source.addEventListener('result', (evt) => {
    const data = JSON.parse(evt.data);
    markAllDone();
    appendLog('Analysis complete.');
    renderResults(data);
    setLoading(false);
    source.close();
    activeSource = null;
  });

  // "failure": an application-level error the server deliberately sent
  // (e.g. bad repo path, Gemini call failed). Distinct from the native
  // "error" event below, which fires for a dropped/failed connection and
  // carries no payload — EventSource reserves "error" for that, so a
  // same-named custom event would be indistinguishable from it.
  source.addEventListener('failure', (evt) => {
    const message = JSON.parse(evt.data).message || 'The analysis failed.';
    markActiveAsError();
    appendLog(`Error: ${message}`);
    showError(message);
    setLoading(false);
    source.close();
    activeSource = null;
  });

  source.addEventListener('error', () => {
    if (source.readyState === EventSource.CLOSED) {
      // We already closed it ourselves after "result" or "failure" — not a real error.
      return;
    }
    const message = 'Connection to the server was lost.';
    markActiveAsError();
    appendLog(`Error: ${message}`);
    showError(message);
    setLoading(false);
    source.close();
    activeSource = null;
  });
});
