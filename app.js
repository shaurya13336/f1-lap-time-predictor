import {
  formatMetric,
  formatPercent,
  loadExperimentArtifacts,
  normalizeModelRow,
  normalizePredictionRow,
  toNumber
} from './lib/results.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const state = {
  artifacts: null,
  degradationDriver: '',
  predictionDriver: '',
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
};

const escapeHTML = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function initReveal() {
  const elements = $$('.reveal');
  if (state.reducedMotion || !('IntersectionObserver' in window)) {
    elements.forEach((element) => element.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        instance.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });
  elements.forEach((element) => observer.observe(element));
}

function initNavigation() {
  const menuToggle = $('.menu-toggle');
  const navCenter = $('.nav-center');
  const navLinks = $$('.nav-links a');

  const closeMenu = () => {
    navCenter?.classList.remove('is-open');
    menuToggle?.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  };

  menuToggle?.addEventListener('click', () => {
    const isOpen = navCenter.classList.toggle('is-open');
    menuToggle.classList.toggle('is-open', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.forEach((link) => link.addEventListener('click', closeMenu));

  const activeMap = {
    overview: ['overview', 'brief'],
    data: ['data'],
    method: ['cleaning', 'tire-age'],
    leakage: ['leakage'],
    models: ['models'],
    degradation: ['degradation'],
    results: ['results', 'final-stint', 'verdict'],
    reproducibility: ['reproducibility']
  };
  const sections = ['overview', 'data', 'cleaning', 'tire-age', 'leakage', 'models', 'degradation', 'results', 'final-stint', 'verdict', 'reproducibility']
    .map((id) => document.getElementById(id)).filter(Boolean);

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const activeSection = entry.target.id;
        navLinks.forEach((link) => {
          const key = link.dataset.nav;
          link.classList.toggle('is-active', (activeMap[key] || []).includes(activeSection));
        });
        $$('.section-index a').forEach((link) => link.classList.toggle('is-active', link.dataset.index === activeSection));
      });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  }
}

function initTelemetryMarker() {
  const path = $('.trace-main');
  const marker = $('.telemetry-marker');
  const car = $('#hero-car');
  const traceX = $('#trace-x');
  const traceY = $('#trace-y');
  const traceSpeed = $('#trace-speed');
  if (!path || typeof path.getTotalLength !== 'function') return;

  const length = path.getTotalLength();
  let paused = false;
  const stage = $('.telemetry-stage');
  stage?.addEventListener('mouseenter', () => { paused = true; });
  stage?.addEventListener('mouseleave', () => { paused = false; });
  stage?.addEventListener('focusin', () => { paused = true; });
  stage?.addEventListener('focusout', () => { paused = false; });
  const place = (distance) => {
    const point = path.getPointAtLength(distance);
    const next = path.getPointAtLength(Math.min(length, distance + 3));
    const angle = Math.atan2(next.y - point.y, next.x - point.x) * 180 / Math.PI;
    if (traceX) traceX.textContent = point.x.toFixed(3).padStart(7, '0');
    if (traceY) traceY.textContent = point.y.toFixed(3).padStart(7, '0');
    marker?.setAttribute('transform', `translate(${point.x - 124} ${point.y - 194})`);
    if (car) {
      const scale = window.innerWidth < 680 ? 0.58 : window.innerWidth < 980 ? 0.68 : 0.78;
      car.setAttribute('transform', `translate(${point.x.toFixed(2)} ${point.y.toFixed(2)}) rotate(${angle.toFixed(2)}) scale(${scale})`);
    }
  };

  if (state.reducedMotion) {
    place(length * .22);
    return;
  }

  const start = performance.now();
  const duration = 8800;
  const move = (now) => {
    const progress = ((now - start) % duration) / duration;
    const paced = progress + (.085 * Math.sin(progress * Math.PI * 2)) - (.025 * Math.sin(progress * Math.PI * 6));
    const distance = Math.max(0, Math.min(length, paced * length));
    if (traceSpeed) {
      const speed = 248 + Math.round(42 * Math.sin(progress * Math.PI * 2 - .7) + 16 * Math.sin(progress * Math.PI * 6));
      traceSpeed.textContent = String(Math.max(180, speed)).padStart(3, '0');
    }
    if (!paused) place(distance);
    requestAnimationFrame(move);
  };
  requestAnimationFrame(move);
}

function initViewportMotion() {
  const targets = [$('#cleaning-visual'), $('#leakage-visual')].filter(Boolean);
  if (state.reducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach((target) => target.classList.add('is-activated'));
    return;
  }
  const observer = new IntersectionObserver((entries, instance) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-activated');
      instance.unobserve(entry.target);
    });
  }, { threshold: .38 });
  targets.forEach((target) => observer.observe(target));
}

function animateArtifactNumber(element, value) {
  const target = toNumber(value);
  if (!element || target === null || state.reducedMotion) return;
  const started = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - started) / 720);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = target * eased;
    element.textContent = Number.isInteger(target) ? Math.round(current) : current.toFixed(3);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function initStoryPhase() {
  const phaseLabel = $('#car-trace-mode');
  const phaseMap = {
    overview: 'CAR / TELEMETRY RUN',
    data: 'CAR / INGEST TRACE',
    cleaning: 'CAR / FILTER TRACE',
    'tire-age': 'CAR / STINT STATE',
    leakage: 'CAR / SPLIT BOUNDARY',
    models: 'CAR / MODEL PASS',
    degradation: 'CAR / PATTERN TRACE',
    results: 'CAR / EVALUATION',
    'final-stint': 'CAR / HOLDOUT TRACE',
    verdict: 'CAR / VERDICT LOCK',
    reproducibility: 'CAR / REPLAYABLE'
  };
  const sections = Object.keys(phaseMap)
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!phaseLabel || !('IntersectionObserver' in window)) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) phaseLabel.textContent = phaseMap[entry.target.id];
    });
  }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
  sections.forEach((section) => observer.observe(section));
}


function initDatasetInteractions() {
  $$('.dataset-node').forEach((node) => {
    node.addEventListener('mouseenter', () => {
      $$('.dataset-node').forEach((other) => other.classList.toggle('is-dimmed', other !== node));
    });
    node.addEventListener('mouseleave', () => $$('.dataset-node').forEach((other) => other.classList.remove('is-dimmed')));
  });
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value;
}

function normalizeKey(value) {
  return String(value ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function displayCount(value) {
  const number = toNumber(value);
  if (number === null) return value === undefined || value === null || value === '' ? '—' : String(value);
  return Number.isInteger(number) ? number.toLocaleString('en-US') : number.toFixed(2);
}

function renderCleaning(rows = []) {
  const values = {};
  rows.forEach((row) => {
    const key = normalizeKey(row.metric || row.name || row.category || row.filter || row.type);
    const value = row.value ?? row.count ?? row.laps ?? row.rows ?? '';
    if (key) values[key] = value;
  });

  const findValue = (...keys) => {
    const key = keys.find((candidate) => values[candidate] !== undefined);
    return key ? values[key] : null;
  };
  const raw = findValue('raw', 'raw_laps', 'raw_rows', 'total_raw', 'raw_data');
  const removed = findValue('removed', 'removed_laps', 'total_removed', 'filtered');
  const retained = findValue('retained', 'retained_laps', 'clean_laps', 'clean_rows');

  $$('[data-cleaning-count]').forEach((element) => {
    const type = element.dataset.cleaningCount;
    const value = type === 'raw' ? raw : type === 'removed' ? removed : retained;
    element.textContent = displayCount(value);
    element.classList.toggle('is-live', toNumber(value) !== null);
    animateArtifactNumber(element, value);
  });

  const keyAliases = {
    pit_stop_laps: ['pit_stop_laps', 'pit_laps', 'pit_stop', 'pit_in_laps'],
    post_pit_laps: ['post_pit_laps', 'post_pit', 'out_laps', 'immediate_post_pit_laps'],
    extreme_slow_laps: ['extreme_slow_laps', 'slow_laps', 'outliers', 'extreme_laps']
  };
  $$('.filter-row').forEach((row) => {
    const requested = row.dataset.cleaningKey;
    const match = (keyAliases[requested] || []).find((candidate) => values[candidate] !== undefined);
    const output = $('strong', row);
    if (output) {
      output.textContent = match ? displayCount(values[match]) : '—';
      if (match) animateArtifactNumber(output, values[match]);
    }
  });

  const hasValues = rows.some((row) => Object.values(row).some((value) => toNumber(value) !== null));
  setText('#cleaning-status', hasValues ? 'ARTIFACT LOADED' : 'EVALUATION PENDING');
  const cleanOutput = $('.clean-output strong');
  if (cleanOutput) cleanOutput.textContent = hasValues ? 'counts verified' : 'awaiting artifact';
}

function modelFeatureLabel(modelRow) {
  const text = `${modelRow.featureSet} ${modelRow.features || ''}`.toLowerCase();
  return text.includes('enhanced') || text.includes('tire')
    ? 'Enhanced · + tire_age'
    : 'Baseline · grid + lap';
}

function modelTableRow(row) {
  const featureLabel = modelFeatureLabel(row);
  const hasMetric = row.rmse !== null || row.mae !== null;
  return `<tr>
    <td>${escapeHTML(row.model)}</td>
    <td><span class="feature-pill ${featureLabel.startsWith('Enhanced') ? 'accent' : ''}">${escapeHTML(featureLabel)}</span></td>
    <td class="metric-cell">${formatMetric(row.rmse)}</td>
    <td class="metric-cell">${formatMetric(row.mae)}</td>
    <td><span class="table-state">${hasMetric ? 'loaded' : 'pending'}</span></td>
  </tr>`;
}

function updateModelTable(rows) {
  const body = $('#model-table-body');
  const status = $('#model-table-status');
  if (!body) return;
  const normalized = rows.map(normalizeModelRow);
  if (normalized.length) body.innerHTML = normalized.map(modelTableRow).join('');
  const hasMetrics = normalized.some((row) => row.rmse !== null || row.mae !== null);
  if (status) status.textContent = hasMetrics ? 'ARTIFACT LOADED' : 'EVALUATION PENDING';
  return normalized;
}

function renderResultBars(rows) {
  const container = $('#result-bars');
  if (!container) return;
  const valid = rows.filter((row) => row.rmse !== null);
  if (!valid.length) return;
  const max = Math.max(...valid.map((row) => row.rmse));
  const min = Math.min(...valid.map((row) => row.rmse));
  const range = max - min || max || 1;
  const sorted = [...valid].sort((a, b) => a.rmse - b.rmse);
  container.innerHTML = sorted.map((row) => {
    const qualityWidth = 26 + ((max - row.rmse) / range) * 67;
    return `<div class="bar-placeholder loaded-bar"><span>${escapeHTML(row.model)}<small>${escapeHTML(modelFeatureLabel(row))}</small></span><div><i style="width:${qualityWidth.toFixed(2)}%"></i></div><b>${formatMetric(row.rmse)}</b></div>`;
  }).join('') + '<p class="bar-note">Bars are scaled from the loaded RMSE range. Lower error leads.</p>';

  $$('.loaded-bar small', container).forEach((small) => {
    small.style.display = 'block';
    small.style.color = 'var(--dim)';
    small.style.fontSize = '8px';
    small.style.marginTop = '4px';
  });
  $$('.loaded-bar b', container).forEach((metric, index) => animateArtifactNumber(metric, sorted[index]?.rmse));
}

function updateWinner(rows) {
  const panel = $('#winner-panel');
  if (!panel) return;
  const valid = rows.filter((row) => row.rmse !== null).sort((a, b) => a.rmse - b.rmse);
  if (!valid.length) return;
  const winner = valid[0];
  panel.innerHTML = `<span class="technical-label">CURRENT LEAD / LOADED ARTIFACT</span>
    <div class="winner-lockup"><span class="winner-glyph">✓</span><div><h3>${escapeHTML(winner.model)}</h3><p>${escapeHTML(modelFeatureLabel(winner))}</p></div></div>
    <div class="winner-metrics"><div><span>RMSE</span><b>${formatMetric(winner.rmse)}</b></div><div><span>MAE</span><b>${formatMetric(winner.mae)}</b></div><div><span>RANKING</span><b>lowest RMSE</b></div></div>`;
}

function meanMetric(rows, enhanced) {
  const valid = rows
    .filter((row) => (modelFeatureLabel(row).startsWith('Enhanced')) === enhanced && row.rmse !== null)
    .map((row) => row.rmse);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function renderVerdict(rows) {
  const baseline = meanMetric(rows, false);
  const enhanced = meanMetric(rows, true);
  const hasPair = baseline !== null && enhanced !== null;
  const metrics = $$('.verdict-metrics b');
  if (!hasPair) return;

  const difference = enhanced - baseline;
  const percentage = baseline === 0 ? null : (difference / baseline) * 100;
  const improved = enhanced < baseline;
  const content = $('#verdict-content');
  if (content) {
    content.classList.add('verdict-live');
    content.innerHTML = `<span class="technical-label">THE QUESTION, ANSWERED BY THE ARTIFACT</span>
      <h2>${improved ? 'TIRE AGE<br /><em>IMPROVED.</em>' : 'TIRE AGE<br /><em>DID NOT IMPROVE.</em>'}</h2>
      <div class="verdict-lock"><span class="lock-cross">${improved ? '↓' : '—'}</span><div><b>${improved ? 'TIRE AGE IMPROVED PREDICTION' : 'TIRE AGE DID NOT IMPROVE PREDICTION'}</b><p>Aggregate RMSE across the loaded baseline and enhanced configurations.</p></div></div>
      <div class="verdict-metrics"><div><span>BASELINE RMSE</span><b>${formatMetric(baseline)}</b></div><div><span>ENHANCED RMSE</span><b>${formatMetric(enhanced)}</b></div><div><span>DIFFERENCE</span><b>${difference > 0 ? '+' : ''}${formatMetric(difference)}</b></div><div><span>CHANGE</span><b>${formatPercent(percentage)}</b></div></div>`;
  } else if (metrics.length >= 4) {
    metrics[0].textContent = formatMetric(baseline);
    metrics[1].textContent = formatMetric(enhanced);
    metrics[2].textContent = formatMetric(difference);
    metrics[3].textContent = formatPercent(percentage);
  }
}

function renderTimeline(rows) {
  const timeline = $('#stint-timeline');
  if (!timeline || !rows.length) return;
  const drivers = rows.map((row) => row.driver).filter(Boolean);
  const driver = state.predictionDriver || drivers[0];
  const driverRows = rows.filter((row) => row.driver === driver);
  if (!driverRows.length) return;
  state.predictionDriver = driver;

  const groups = new Map();
  driverRows.forEach((row) => {
    const key = row.stint || row.split || 'observed stint';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  const grouped = Array.from(groups.entries()).map(([key, group]) => [key, group.sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0))]);
  const segments = grouped.map(([key, group], index) => {
    const ages = group.map((row) => row.tireAge).filter((value) => value !== null);
    const firstAge = ages[0] ?? null;
    const lastAge = ages[ages.length - 1] ?? null;
    const ageText = firstAge === null ? 'AGE / —' : `AGE ${firstAge} → ${lastAge}`;
    return `<div class="timeline-segment actual-segment"><span class="pit-marker">${escapeHTML(String(key).toUpperCase())}</span><div class="segment-bar" style="--segment-width:${Math.max(30, Math.min(100, group.length * 7))}%"></div><div class="segment-ticks"><i>${group.length} OBSERVED LAPS</i><i>${escapeHTML(ageText)}</i><i>${index === grouped.length - 1 ? 'FINAL STINT' : 'STINT'}</i></div></div>${index < grouped.length - 1 ? '<div class="timeline-reset">↻</div>' : ''}`;
  }).join('');
  timeline.innerHTML = `<div class="timeline-guide"><span>${escapeHTML(driver)}</span><span>${grouped.length} STINT${grouped.length === 1 ? '' : 'S'}</span></div><div class="timeline-track">${segments}</div><div class="timeline-legend"><span><i class="legend-dot red"></i> pit event / reset</span><span><i class="legend-dot muted"></i> tire_age from loaded rows</span><span>INTERACTION ENABLED</span></div>`;
  $$('.actual-segment', timeline).forEach((segment, index) => {
    segment.tabIndex = 0;
    segment.setAttribute('role', 'button');
    segment.setAttribute('aria-label', `Inspect stint ${grouped[index][0]} for ${driver}`);
    const focusSegment = () => {
      $$('.actual-segment', timeline).forEach((item) => item.classList.remove('is-selected'));
      segment.classList.add('is-selected');
      renderTireAgeFocus(grouped[index][1][0], driverRows);
    };
    segment.addEventListener('click', focusSegment);
    segment.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusSegment(); }
    });
  });
}

function renderTireAgeFocus(row, driverRows = []) {
  if (!row) return;
  const ring = $('.tire-ring');
  const ringValue = $('.tire-ring-inner strong');
  const chip = $('.pending-chip');
  const readouts = $$('.gauge-readout b');
  const ages = driverRows.map((item) => item.tireAge).filter((value) => value !== null);
  const maxAge = Math.max(...ages, row.tireAge ?? 1, 1);
  const progress = Math.max(14, Math.min(340, ((row.tireAge ?? 0) / maxAge) * 340));
  if (ring) {
    ring.classList.add('has-focus');
    ring.style.background = `conic-gradient(var(--red) 0deg ${progress}deg, rgba(233,73,63,.12) ${progress}deg ${progress + 10}deg, rgba(173,196,197,.18) ${progress + 10}deg 360deg)`;
  }
  if (ringValue) ringValue.textContent = row.tireAge ?? '—';
  if (chip) chip.textContent = `ROW / ${row.driver} · LAP ${row.lap}`;
  if (readouts.length >= 3) {
    readouts[0].textContent = row.lap ?? '—';
    readouts[1].textContent = row.stint ?? '—';
    readouts[2].textContent = row.actual === null ? '—' : `${formatMetric(row.actual)} s`;
  }
  const status = $('.gauge-foot span:last-child');
  if (status) status.textContent = `LOADED ROW / ${row.driver} / FINAL STINT`;
}

function chartScales(points, xKey, yKey, width, height, padding) {
  const xs = points.map((point) => point[xKey]).filter((value) => Number.isFinite(value));
  const ys = points.map((point) => point[yKey]).filter((value) => Number.isFinite(value));
  if (!xs.length || !ys.length) return null;
  let xMin = Math.min(...xs);
  let xMax = Math.max(...xs);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const yPad = (yMax - yMin) * .08;
  yMin -= yPad; yMax += yPad;
  return {
    xMin, xMax, yMin, yMax,
    x: (value) => padding.left + ((value - xMin) / (xMax - xMin)) * (width - padding.left - padding.right),
    y: (value) => height - padding.bottom - ((value - yMin) / (yMax - yMin)) * (height - padding.top - padding.bottom)
  };
}

function chartGrid(scales, width, height, padding, xTitle, yTitle) {
  const lines = [];
  const yRange = scales.yMax - scales.yMin;
  const xRange = scales.xMax - scales.xMin;
  for (let i = 0; i <= 4; i += 1) {
    const value = scales.yMin + (yRange * i) / 4;
    const y = scales.y(value);
    lines.push(`<line class="chart-grid" x1="${padding.left}" x2="${width - padding.right}" y1="${y}" y2="${y}" /><text class="chart-label" x="${padding.left - 10}" y="${y + 3}" text-anchor="end">${formatMetric(value, 2)}</text>`);
  }
  for (let i = 0; i <= 5; i += 1) {
    const value = scales.xMin + (xRange * i) / 5;
    const x = scales.x(value);
    lines.push(`<line class="chart-grid" x1="${x}" x2="${x}" y1="${padding.top}" y2="${height - padding.bottom}" /><text class="chart-label" x="${x}" y="${height - 13}" text-anchor="middle">${formatMetric(value, Number.isInteger(value) ? 0 : 1)}</text>`);
  }
  lines.push(`<line class="chart-axis" x1="${padding.left}" x2="${width - padding.right}" y1="${height - padding.bottom}" y2="${height - padding.bottom}" /><line class="chart-axis" x1="${padding.left}" x2="${padding.left}" y1="${padding.top}" y2="${height - padding.bottom}" />`);
  lines.push(`<text class="chart-label" x="${width - padding.right}" y="${height - 3}" text-anchor="end">${xTitle}</text><text class="chart-label" x="14" y="${padding.top - 9}">${yTitle}</text>`);
  return lines.join('');
}

function showTooltip(element, tooltip, html, event, stage) {
  if (!tooltip || !stage) return;
  const rect = stage.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  tooltip.innerHTML = html;
  tooltip.style.left = `${Math.min(Math.max(10, x + 12), rect.width - 150)}px`;
  tooltip.style.top = `${Math.min(Math.max(10, y - 25), rect.height - 95)}px`;
  tooltip.classList.add('is-visible');
}

function drawDegradationChart(rows) {
  const svg = $('#degradation-svg');
  const empty = $('#degradation-empty');
  const stage = $('#degradation-stage');
  const points = rows.filter((row) => row.tireAge !== null && row.actual !== null).sort((a, b) => a.tireAge - b.tireAge || (a.lap ?? 0) - (b.lap ?? 0));
  if (!svg || !empty || !points.length) {
    if (svg) svg.innerHTML = '';
    empty?.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');
  const width = 1000; const height = 430; const padding = { left: 70, right: 28, top: 32, bottom: 47 };
  const scales = chartScales(points, 'tireAge', 'actual', width, height, padding);
  if (!scales) return;
  const line = points.map((point, index) => `${index ? 'L' : 'M'} ${scales.x(point.tireAge).toFixed(2)} ${scales.y(point.actual).toFixed(2)}`).join(' ');
  const dots = points.map((point, index) => `<circle class="chart-point" data-point-index="${index}" cx="${scales.x(point.tireAge).toFixed(2)}" cy="${scales.y(point.actual).toFixed(2)}" r="3.5" />`).join('');
  svg.innerHTML = `${chartGrid(scales, width, height, padding, 'tire_age / laps elapsed', 'lap_time')}<path class="chart-path" d="${line}" />${dots}`;

  const tooltip = $('#degradation-tooltip');
  $$('.chart-point', svg).forEach((point) => {
    const item = points[Number(point.dataset.pointIndex)];
    point.addEventListener('mouseenter', (event) => showTooltip(point, tooltip, `<div class="tooltip-title">OBSERVED ROW</div><div class="tooltip-row"><span>lap</span><b>${escapeHTML(item.lap ?? '—')}</b></div><div class="tooltip-row"><span>tire_age</span><b>${escapeHTML(item.tireAge)}</b></div><div class="tooltip-row"><span>lap time</span><b>${formatMetric(item.actual)}</b></div>`, event, stage));
    point.addEventListener('mousemove', (event) => showTooltip(point, tooltip, tooltip.innerHTML, event, stage));
    point.addEventListener('mouseleave', () => tooltip?.classList.remove('is-visible'));
  });
}

function renderDegradation(rows) {
  const normalized = rows.map(normalizePredictionRow);
  const drivers = [...new Set(normalized.map((row) => row.driver).filter(Boolean))];
  const filter = $('#driver-filter');
  const stateLabel = $('#degradation-state');
  if (!filter) return;
  if (!drivers.length || !normalized.some((row) => row.tireAge !== null && row.actual !== null)) {
    filter.disabled = true;
    filter.innerHTML = '<option>Awaiting prediction rows</option>';
    stateLabel && (stateLabel.textContent = 'EVALUATION PENDING');
    drawDegradationChart([]);
    return;
  }
  if (!drivers.includes(state.degradationDriver)) state.degradationDriver = drivers[0];
  filter.disabled = false;
  filter.innerHTML = drivers.map((driver) => `<option value="${escapeHTML(driver)}" ${driver === state.degradationDriver ? 'selected' : ''}>${escapeHTML(driver)}</option>`).join('');
  stateLabel && (stateLabel.textContent = 'ARTIFACT LOADED');
  const filtered = normalized.filter((row) => row.driver === state.degradationDriver);
  drawDegradationChart(filtered);
  filter.onchange = () => {
    state.degradationDriver = filter.value;
    drawDegradationChart(normalized.filter((row) => row.driver === state.degradationDriver));
  };
}

function explicitFinalRows(summary, rows) {
  const testRows = rows.filter((row) => {
    const split = String(row.split || row.set || row.partition || row.phase || '').toLowerCase();
    const testFlag = String(row.isTest ?? '').toLowerCase();
    return split.includes('test') || split.includes('final') || testFlag === 'true' || testFlag === '1' || testFlag === 'test' || testFlag === 'final';
  });
  if (testRows.length) return testRows;

  const finalStint = summary?.final_stint ?? summary?.final_stint_id ?? summary?.test_stint;
  if (finalStint !== undefined && finalStint !== null && finalStint !== '') {
    return rows.filter((row) => String(row.stint) === String(finalStint) || String(row.stintId) === String(finalStint));
  }
  return [];
}

function drawPredictionChart(rows) {
  const svg = $('#prediction-svg');
  const empty = $('#prediction-empty');
  const stage = $('#prediction-chart-shell');
  const points = rows.filter((row) => row.lap !== null && (row.actual !== null || row.predicted !== null)).sort((a, b) => a.lap - b.lap);
  const drawable = points.filter((row) => row.actual !== null && row.predicted !== null);
  if (!svg || !empty || !drawable.length) {
    if (svg) svg.innerHTML = '';
    empty?.classList.remove('is-hidden');
    return;
  }
  empty.classList.add('is-hidden');
  const width = 1200; const height = 500; const padding = { left: 71, right: 27, top: 48, bottom: 53 };
  const scales = chartScales(drawable, 'lap', 'actual', width, height, padding);
  if (!scales) return;
  const allY = drawable.flatMap((point) => [point.actual, point.predicted]);
  const allMin = Math.min(...allY); const allMax = Math.max(...allY);
  const yPad = (allMax - allMin || 1) * .12;
  const yScale = { ...scales, yMin: allMin - yPad, yMax: allMax + yPad };
  yScale.y = (value) => height - padding.bottom - ((value - yScale.yMin) / (yScale.yMax - yScale.yMin)) * (height - padding.top - padding.bottom);
  const actualPath = drawable.map((point, index) => `${index ? 'L' : 'M'} ${yScale.x(point.lap).toFixed(2)} ${yScale.y(point.actual).toFixed(2)}`).join(' ');
  const predictedPath = drawable.map((point, index) => `${index ? 'L' : 'M'} ${yScale.x(point.lap).toFixed(2)} ${yScale.y(point.predicted).toFixed(2)}`).join(' ');
  const firstX = yScale.x(drawable[0].lap); const lastX = yScale.x(drawable[drawable.length - 1].lap);
  const dots = drawable.map((point, index) => `<circle class="chart-point" data-point-index="${index}" cx="${yScale.x(point.lap).toFixed(2)}" cy="${yScale.y(point.actual).toFixed(2)}" r="3.5" />`).join('');
  const grid = chartGrid(yScale, width, height, padding, 'lap number', 'lap time');
  svg.innerHTML = `<rect class="test-band" x="${firstX}" y="${padding.top}" width="${Math.max(1, lastX - firstX)}" height="${height - padding.top - padding.bottom}" /><text class="chart-label" x="${firstX + 10}" y="25" fill="var(--red-bright)">FINAL STINT / TEST</text>${grid}<path class="chart-path" d="${actualPath}" /><path class="chart-path predicted" d="${predictedPath}" />${dots}`;

  const tooltip = $('#prediction-tooltip');
  $$('.chart-point', svg).forEach((point) => {
    const item = drawable[Number(point.dataset.pointIndex)];
    const error = item.error !== null ? item.error : item.actual - item.predicted;
    const html = `<div class="tooltip-title">FINAL-STINT ROW</div><div class="tooltip-row"><span>lap</span><b>${escapeHTML(item.lap)}</b></div><div class="tooltip-row"><span>actual</span><b>${formatMetric(item.actual)}</b></div><div class="tooltip-row"><span>predicted</span><b>${formatMetric(item.predicted)}</b></div><div class="tooltip-row"><span>error</span><b>${formatMetric(error)}</b></div>`;
    point.addEventListener('mouseenter', (event) => showTooltip(point, tooltip, html, event, stage));
    point.addEventListener('mousemove', (event) => showTooltip(point, tooltip, html, event, stage));
    point.addEventListener('mouseleave', () => tooltip?.classList.remove('is-visible'));
  });
}

function renderPrediction(rows, summary) {
  const normalized = rows.map(normalizePredictionRow);
  const finalRows = explicitFinalRows(summary, normalized);
  const driverElement = $('#prediction-driver');
  const status = $('#prediction-status');
  if (!finalRows.length) {
    drawPredictionChart([]);
    if (driverElement) driverElement.textContent = 'DRIVER / ARTIFACT REQUIRED';
    if (status) status.textContent = 'WAITING FOR ARTIFACT';
    return;
  }
  const drivers = [...new Set(finalRows.map((row) => row.driver).filter(Boolean))];
  const summaryDriver = summary?.final_stint_visualization?.driver || summary?.final_stint_driver || summary?.test_driver;
  const chosen = drivers.includes(summaryDriver) ? summaryDriver : (drivers.includes(state.predictionDriver) ? state.predictionDriver : drivers[0]);
  state.predictionDriver = chosen;
  const selected = finalRows.filter((row) => row.driver === chosen);
  const bestModel = summary?.best_configuration?.model || 'MODEL';
  const bestFeatureSet = summary?.best_configuration?.feature_set || 'evaluated';
  if (driverElement) driverElement.textContent = `${chosen} / FINAL STINT · ${bestModel} / ${bestFeatureSet}`;
  if (status) status.textContent = 'ARTIFACT LOADED';
  drawPredictionChart(selected);
  const selectedDriverRows = normalized.filter((row) => row.driver === chosen);
  renderTimeline(selectedDriverRows);
  renderTireAgeFocus(selected[0], selectedDriverRows);
}

function updateArtifactStatus(artifacts) {
  const ready = artifacts.hasMetrics || artifacts.hasPredictions;
  const label = $('#nav-artifact-status');
  const led = $('.nav-status .status-led');
  if (ready) {
    label && (label.textContent = 'ARTIFACTS LOADED');
    led?.classList.remove('pending');
    led?.classList.add('ready');
  } else {
    label && (label.textContent = 'ARTIFACTS PENDING');
  }
}

function renderSummary(summary = {}) {
  const race = summary.selected_race || {};
  const dry = summary.dry_race_eligibility || {};
  const best = summary.best_configuration || {};
  const completed = race.completed_drivers ?? '—';
  const raceLabel = race.year && race.name ? `${race.year} ${race.name}` : 'EVALUATION PENDING';
  const traceStrong = $('.trace-readout strong');
  const traceSmall = $('.trace-readout small');
  if (traceStrong) traceStrong.textContent = raceLabel;
  if (traceSmall) traceSmall.textContent = summary.status === 'complete'
    ? `${completed} completed drivers · final-stint holdout active.`
    : 'Telemetry becomes evidence only after the generated results are connected.';

  const runMeta = $('#data-run-meta');
  if (runMeta) runMeta.textContent = summary.status === 'complete'
    ? `RUN / ${raceLabel.toUpperCase()} · ${completed} COMPLETED DRIVERS · DRY LABEL EXTERNAL`
    : 'RUN / EVALUATION PENDING';

  const sourceFiles = summary.source?.files || {};
  $$('[data-source-state]').forEach((element) => {
    const shape = sourceFiles[element.dataset.sourceState];
    if (Array.isArray(shape) && shape.length >= 2) {
      element.textContent = `${Number(shape[0]).toLocaleString('en-US')} rows`;
    }
  });

  const telemetryCells = $$('.telemetry-footer > div');
  if (telemetryCells.length >= 3 && summary.status === 'complete') {
    const values = [
      ['tire_age', 'loaded'],
      ['final stint', 'held out'],
      [best.model ? `${best.model} / ${best.feature_set || 'evaluated'}` : 'two regressors', 'evaluated']
    ];
    values.forEach(([value, status], index) => {
      const cell = telemetryCells[index];
      const strong = $('b', cell);
      const em = $('em', cell);
      if (strong) strong.textContent = value;
      if (em) em.textContent = status;
    });
  }
  const stintStatus = $('.stint-status');
  if (stintStatus && summary.status === 'complete') {
    stintStatus.textContent = `${raceLabel.toUpperCase()} / ${completed} COMPLETED DRIVERS`;
  }

  const verification = summary.race_eligibility_verification || {};
  const verificationValues = [
    verification.dry_race?.verified ? 'verified' : 'pending',
    verification.no_red_flag?.verified ? 'verified' : 'pending',
    verification.completed_driver_rule?.completed_drivers ?? '—',
    verification.final_stint_holdout?.verified ? 'verified' : 'pending'
  ];
  $$('.verification-grid b').forEach((element, index) => {
    element.textContent = verificationValues[index] ?? '—';
    element.classList.toggle('is-verified', verificationValues[index] === 'verified');
  });
}

async function initArtifacts() {
  try {
    state.artifacts = await loadExperimentArtifacts();
  } catch (error) {
    state.artifacts = { summary: {}, modelComparison: [], cleaningSummary: [], stintPredictions: [], hasMetrics: false, hasPredictions: false };
  }
  const artifacts = state.artifacts;
  updateArtifactStatus(artifacts);
  renderSummary(artifacts.summary);
  renderCleaning(artifacts.cleaningSummary);
  const modelRows = updateModelTable(artifacts.modelComparison) || [];
  const normalizedModels = modelRows.length ? modelRows : artifacts.modelComparison.map(normalizeModelRow);
  renderResultBars(normalizedModels);
  updateWinner(normalizedModels);
  renderVerdict(normalizedModels);
  renderDegradation(artifacts.stintPredictions);
  renderPrediction(artifacts.stintPredictions, artifacts.summary);
  initLivePredictor(artifacts.summary);
}


async function initLivePredictor(summary = {}) {
  const driverSelect = $('#predict-driver');
  const gridInput = $('#predict-grid');
  const lapInput = $('#predict-lap');
  const tireInput = $('#predict-tire-age');
  const button = $('#predict-button');
  const message = $('#predict-message');
  const result = $('#predict-result');
  if (!driverSelect || !button) return;

  try {
    const healthResponse = await fetch('/api');
    const health = await healthResponse.json();
    if (!healthResponse.ok || !health.ok) throw new Error(health.detail || 'Model API unavailable');
    const drivers = health.drivers || [];
    driverSelect.innerHTML = drivers.map((driver) => `<option value="${escapeHTML(driver)}">${escapeHTML(driver)}</option>`).join('');
    message.innerHTML = '<span class="red-dot"></span> TRAINED ARTIFACT CONNECTED';
    message.classList.add('is-ready');

    button.addEventListener('click', async () => {
      const grid = Number(gridInput.value);
      const lap = Number(lapInput.value);
      const tireAge = Number(tireInput.value);
      if (!Number.isInteger(grid) || grid < 1 || !Number.isInteger(lap) || lap < 1 || !Number.isInteger(tireAge) || tireAge < 0) {
        result.textContent = 'Enter valid integer values for grid, lap, and tire age.';
        result.classList.add('is-error');
        return;
      }
      button.disabled = true;
      button.classList.add('is-loading');
      result.textContent = 'RUNNING TRAINED MODEL…';
      result.classList.remove('is-error');
      try {
        const response = await fetch('/api/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver: driverSelect.value, grid_position: grid, lap_number: lap, tire_age: tireAge })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Prediction failed');
        result.innerHTML = `<span class="predict-result-label">PREDICTED LAP TIME</span><strong>${formatMetric(data.prediction)} s</strong><small>${escapeHTML(data.model)} / ${escapeHTML(data.feature_set)} · ${escapeHTML(data.driver)}</small>`;
      } catch (error) {
        result.textContent = error.message;
        result.classList.add('is-error');
      } finally {
        button.disabled = false;
        button.classList.remove('is-loading');
      }
    });
  } catch (error) {
    driverSelect.innerHTML = '<option>MODEL UNAVAILABLE</option>';
    button.disabled = true;
    message.innerHTML = '<span class="red-dot"></span> MODEL API NOT AVAILABLE';
    result.textContent = error.message;
    result.classList.add('is-error');
  }
}

function init() {
  initReveal();
  initNavigation();
  initTelemetryMarker();
  initStoryPhase();
  initDatasetInteractions();
  initViewportMotion();
  initArtifacts();
}

document.addEventListener('DOMContentLoaded', init);
