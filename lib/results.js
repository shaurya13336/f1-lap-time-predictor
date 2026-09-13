/**
 * Artifact-aware data access layer.
 *
 * The presentation never owns experiment numbers. It asks this module for
 * generated artifacts and remains intentionally useful while those artifacts
 * are still pending.
 */

export const ARTIFACT_PATHS = {
  summary: './results/summary.json',
  modelComparison: './results/model_comparison.csv',
  cleaningSummary: './results/cleaning_summary.csv',
  cleaningByDriver: './results/cleaning_by_driver.csv',
  eligibleRaces: './results/eligible_races.csv',
  stintPredictions: './results/stint_predictions.csv'
};

const EMPTY_ARTIFACT = Object.freeze({ available: false, error: null });

function parseCSVLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    const next = line[i + 1];

    if (character === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCSV(text = '') {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((header) => header.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = parseCSVLine(line);
    return headers.reduce((record, header, index) => {
      record[header] = cells[index] ?? '';
      return record;
    }, {});
  });
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeArtifact(value, kind) {
  if (kind === 'json') {
    return { available: true, value: value ?? {} };
  }
  return { available: true, value: parseCSV(value) };
}

async function fetchArtifact(path, kind) {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const raw = kind === 'json' ? await response.json() : await response.text();
    return normalizeArtifact(raw, kind);
  } catch (error) {
    return { ...EMPTY_ARTIFACT, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function loadExperimentArtifacts() {
  const [summary, modelComparison, cleaningSummary, cleaningByDriver, eligibleRaces, stintPredictions] = await Promise.all([
    fetchArtifact(ARTIFACT_PATHS.summary, 'json'),
    fetchArtifact(ARTIFACT_PATHS.modelComparison, 'csv'),
    fetchArtifact(ARTIFACT_PATHS.cleaningSummary, 'csv'),
    fetchArtifact(ARTIFACT_PATHS.cleaningByDriver, 'csv'),
    fetchArtifact(ARTIFACT_PATHS.eligibleRaces, 'csv'),
    fetchArtifact(ARTIFACT_PATHS.stintPredictions, 'csv')
  ]);

  const modelRows = modelComparison.value ?? [];
  const predictionRows = stintPredictions.value ?? [];
  const numericModelRows = modelRows.filter((row) => toNumber(row.rmse) !== null || toNumber(row.mae) !== null);

  return {
    summary: summary.value ?? {},
    modelComparison: modelRows,
    cleaningSummary: cleaningSummary.value ?? [],
    cleaningByDriver: cleaningByDriver.value ?? [],
    eligibleRaces: eligibleRaces.value ?? [],
    stintPredictions: predictionRows,
    availability: {
      summary: summary.available,
      modelComparison: modelComparison.available,
      cleaningSummary: cleaningSummary.available,
      cleaningByDriver: cleaningByDriver.available,
      eligibleRaces: eligibleRaces.available,
      stintPredictions: stintPredictions.available
    },
    hasMetrics: numericModelRows.length > 0,
    hasPredictions: predictionRows.some((row) => toNumber(row.actual) !== null || toNumber(row.predicted) !== null),
    loadedAt: new Date().toISOString()
  };
}

export function normalizeModelRow(row) {
  const model = row.model || row.algorithm || row.estimator || 'Model';
  const featureSet = row.feature_set || row.features || row.feature_set_name || 'Feature set';
  const normalizedModel = String(model).toLowerCase().includes('gradient')
    ? 'Gradient Boosting'
    : String(model).toLowerCase().includes('forest')
      ? 'Random Forest'
      : model;
  const normalizedFeatureSet = String(featureSet).toLowerCase().includes('enhanced')
    || String(featureSet).toLowerCase().includes('tire')
    ? 'Enhanced · + tire_age'
    : 'Baseline · grid + lap';

  return {
    ...row,
    model: normalizedModel,
    featureSet: normalizedFeatureSet,
    rmse: toNumber(row.rmse),
    mae: toNumber(row.mae)
  };
}

export function normalizePredictionRow(row) {
  const pick = (...keys) => {
    const key = keys.find((candidate) => row[candidate] !== undefined && row[candidate] !== '');
    return key ? row[key] : null;
  };
  return {
    ...row,
    driver: pick('driver', 'driver_name', 'code') || 'Driver',
    stint: pick('stint', 'stint_id') || '',
    split: pick('split', 'set', 'partition', 'phase') || '',
    isTest: pick('is_test', 'test', 'is_final') ?? '',
    lap: toNumber(pick('lap', 'lap_number')),
    tireAge: toNumber(pick('tire_age', 'tireage', 'age')),
    actual: toNumber(pick('actual', 'actual_lap_time', 'lap_time')),
    predicted: toNumber(pick('predicted', 'predicted_lap_time', 'prediction')),
    error: toNumber(pick('error', 'residual'))
  };
}

export function formatMetric(value, digits = 3) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export function formatPercent(value, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(digits)}%`;
}
