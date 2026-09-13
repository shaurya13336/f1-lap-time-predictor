/**
 * Source-table contract. The experiment runner can map its raw CSV inputs to
 * these names before writing result artifacts. The UI only needs the artifact
 * contract in lib/results.js, so raw data never gets bundled into components.
 */
export const SOURCE_TABLES = Object.freeze([
  { key: 'races', file: 'races.csv', purpose: 'race metadata and event structure' },
  { key: 'results', file: 'results.csv', purpose: 'driver outcomes and grid information' },
  { key: 'lapTimes', file: 'lap_times.csv', purpose: 'lap-by-lap timing observations' },
  { key: 'pitStops', file: 'pit_stops.csv', purpose: 'pit events for stint reconstruction' }
]);

export const FEATURE_SETS = Object.freeze({
  baseline: ['grid_position', 'lap_number'],
  enhanced: ['grid_position', 'lap_number', 'tire_age']
});

export const EVALUATION_RULE = 'earlier stints train; entire final stint test';
