/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { useEffect, useRef, useState } from 'react';
import { monthPeriod, type Period } from './period';

/**
 * The period to report on: a UTC month, or a custom range of days. The
 * range is passed on as typed; the API says when it isn't a valid one.
 */
export function PeriodPicker({
  month,
  onMonthChange,
  onPeriodChange,
}: {
  month: string;
  onMonthChange: (month: string) => void;
  onPeriodChange: (period: Period) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [range, setRange] = useState<Period>(() => monthPeriod(month));

  const fromRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  // After either button swaps the fields, focus the first new one.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (custom ? fromRef : monthRef).current?.focus();
  }, [custom]);

  const changeRange = (next: Period) => {
    setRange(next);
    if (next.from && next.to) onPeriodChange(next);
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      {custom ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="earnings-from">From</Label>
            <Input
              ref={fromRef}
              id="earnings-from"
              type="date"
              value={range.from}
              onChange={(event) =>
                changeRange({ ...range, from: event.target.value })
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="earnings-to">To</Label>
            <Input
              id="earnings-to"
              type="date"
              value={range.to}
              onChange={(event) =>
                changeRange({ ...range, to: event.target.value })
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              moved.current = true;
              setCustom(false);
              onPeriodChange(monthPeriod(month));
            }}
          >
            Choose a month
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor="earnings-month">Month (UTC)</Label>
            <Input
              ref={monthRef}
              id="earnings-month"
              type="month"
              value={month}
              onChange={(event) => {
                if (event.target.value) onMonthChange(event.target.value);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setRange(monthPeriod(month));
              moved.current = true;
              setCustom(true);
            }}
          >
            Custom range
          </Button>
        </>
      )}
    </div>
  );
}
