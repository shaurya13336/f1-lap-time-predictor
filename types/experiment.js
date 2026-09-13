/** @typedef {{ model: string, feature_set: string, rmse: number|string|null, mae: number|string|null }} ModelComparisonRow */
/** @typedef {{ metric: string, value: number|string|null }} CleaningSummaryRow */
/** @typedef {{ driver: string, stint: string|number, split: string, lap: number, tire_age: number, actual: number, predicted: number, error: number }} StintPredictionRow */
/** @typedef {{ status?: string, final_stint?: string|number, final_stint_driver?: string, schema_version?: string }} ExperimentSummary */

export {};
