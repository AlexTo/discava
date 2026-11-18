/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Checkbox } from '@discava/common-shadcn/components/ui/checkbox';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  type CatalogueFilters,
  DURATION_LABELS,
  hasCatalogueFilters,
  LANGUAGE_LABELS,
  LEVEL_LABELS,
  NO_FILTERS,
} from '../lib/catalogue-filters';

export interface CatalogueFacets {
  categories: { id: string; name: string; slug: string; count: number }[];
  tags: { value: string; count: number }[];
  levels: { value: string; count: number }[];
  languages: { value: string; count: number }[];
  durationBands: { value: string; count: number }[];
}

interface Option {
  value: string;
  label: string;
  count: number;
}

const toggle = (values: string[], value: string, on: boolean) =>
  on ? [...values, value] : values.filter((item) => item !== value);

function Group({
  name,
  options,
  selected,
  onChange,
}: {
  name: string;
  options: Option[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  if (options.length === 0) {
    return null;
  }
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">{name}</legend>
      {options.map(({ value, label, count }) => {
        const id = `filter-${name}-${value}`;
        return (
          <div key={value} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={selected.includes(value)}
              onCheckedChange={(checked) =>
                onChange(toggle(selected, value, checked === true))
              }
            />
            <Label htmlFor={id} className="flex-1 font-normal">
              {label}{' '}
              <span className="ml-auto text-muted-foreground">({count})</span>
            </Label>
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * The catalogue's filter panel, shared by the home page and search: one group
 * each for category, level, language, duration and tags, every value with its
 * count (what picking it would give, with the other filters kept). The
 * category group is left out where the category is fixed.
 */
export function CatalogueFilterPanel({
  facets,
  filters,
  onChange,
  showCategory = true,
}: {
  facets: CatalogueFacets;
  filters: CatalogueFilters;
  onChange: (filters: CatalogueFilters) => void;
  showCategory?: boolean;
}) {
  return (
    <aside aria-label="Filters" className="space-y-6">
      {hasCatalogueFilters(filters) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange(NO_FILTERS)}
        >
          Clear filters
        </Button>
      )}
      {showCategory && (
        <Group
          name="Category"
          options={facets.categories.map(({ slug, name, count }) => ({
            value: slug,
            label: name,
            count,
          }))}
          selected={filters.category ? [filters.category] : []}
          onChange={(values) =>
            // One category at a time: the newest pick replaces the last.
            onChange({
              ...filters,
              category: values.find((slug) => slug !== filters.category),
            })
          }
        />
      )}
      <Group
        name="Level"
        options={facets.levels.map(({ value, count }) => ({
          value,
          label: LEVEL_LABELS[value] ?? value,
          count,
        }))}
        selected={filters.levels}
        onChange={(levels) => onChange({ ...filters, levels })}
      />
      <Group
        name="Language"
        options={facets.languages.map(({ value, count }) => ({
          value,
          label: LANGUAGE_LABELS[value] ?? value,
          count,
        }))}
        selected={filters.languages}
        onChange={(languages) => onChange({ ...filters, languages })}
      />
      <Group
        name="Duration"
        options={facets.durationBands.map(({ value, count }) => ({
          value,
          label: DURATION_LABELS[value] ?? value,
          count,
        }))}
        selected={filters.durations}
        onChange={(durations) => onChange({ ...filters, durations })}
      />
      <Group
        name="Tags"
        options={facets.tags.map(({ value, count }) => ({
          value,
          label: value,
          count,
        }))}
        selected={filters.tags}
        onChange={(tags) => onChange({ ...filters, tags })}
      />
    </aside>
  );
}
