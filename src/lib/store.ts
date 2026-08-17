import type { Dataset } from './types';

const STORAGE_KEY = 'auction-results-dataset-v1';

export function loadDataset(): Dataset {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], uploads: [] };
    const parsed = JSON.parse(raw) as Dataset;
    if (!Array.isArray(parsed.records) || !Array.isArray(parsed.uploads)) {
      return { records: [], uploads: [] };
    }
    return parsed;
  } catch {
    return { records: [], uploads: [] };
  }
}

export function saveDataset(dataset: Dataset): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
}

export function clearDataset(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function exportDatasetAsJson(dataset: Dataset): string {
  return JSON.stringify(dataset, null, 2);
}
