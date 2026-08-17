import { useFilters } from '../hooks/useFilters';
import { useDataset } from '../hooks/useDataset';
import { distinctFacilities, distinctStatuses, distinctYears, MONTH_NAMES } from '../lib/filters';

export function FiltersBar() {
  const { dataset } = useDataset();
  const { filters, updateFilter, clearFilters } = useFilters();

  const facilities = distinctFacilities(dataset.records);
  const statuses = distinctStatuses(dataset.records);
  const years = distinctYears(dataset.records);

  const hasActiveFilters = filters.facility || filters.year || filters.month || filters.status || filters.unitSearch;

  return (
    <div className="filters-bar">
      <div className="filters-bar__field filters-bar__field--grow">
        <label htmlFor="filter-facility">Facility</label>
        <select
          id="filter-facility"
          value={filters.facility}
          onChange={(e) => updateFilter({ facility: e.target.value })}
        >
          <option value="">All facilities</option>
          {facilities.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
      </div>

      <div className="filters-bar__field">
        <label htmlFor="filter-year">Year</label>
        <select id="filter-year" value={filters.year} onChange={(e) => updateFilter({ year: e.target.value })}>
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      <div className="filters-bar__field">
        <label htmlFor="filter-month">Month</label>
        <select id="filter-month" value={filters.month} onChange={(e) => updateFilter({ month: e.target.value })}>
          <option value="">All months</option>
          {MONTH_NAMES.map((m) => (
            <option key={m} value={m.slice(0, 2)}>{m}</option>
          ))}
        </select>
      </div>

      <div className="filters-bar__field">
        <label htmlFor="filter-status">Status</label>
        <select id="filter-status" value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })}>
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="filters-bar__field filters-bar__field--grow">
        <label htmlFor="filter-unit">Unit search</label>
        <input
          id="filter-unit"
          type="text"
          placeholder="e.g. H19"
          value={filters.unitSearch}
          onChange={(e) => updateFilter({ unitSearch: e.target.value })}
        />
      </div>

      {hasActiveFilters && (
        <button type="button" className="filters-bar__clear" onClick={clearFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}
