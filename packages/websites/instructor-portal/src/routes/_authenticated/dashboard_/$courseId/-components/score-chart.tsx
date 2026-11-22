/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@discava/common-shadcn/components/ui/chart';
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

export interface ScoreBandFigures {
  from: number;
  to: number;
  students: number;
}

const config = {
  students: { label: 'Students', color: 'var(--chart-1)' },
} satisfies ChartConfig;

// Below this container width the x-axis labels every other band.
const NARROW_WIDTH = 480;

const bandLabel = ({ from, to }: ScoreBandFigures) => `${from}-${to}`;

// One bar per score band of the students' best scores, with the same figures
// as a table for assistive technology, which the bars alone don't give.
export function ScoreChart({
  title,
  bands,
}: {
  title: string;
  bands: ScoreBandFigures[];
}) {
  const data = bands.map((band) => ({
    band: bandLabel(band),
    students: band.students,
  }));

  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setNarrow(entry.contentRect.width < NARROW_WIDTH);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef}>
      <ChartContainer
        config={config}
        className="aspect-auto h-48 w-full"
        aria-hidden="true"
      >
        <BarChart data={data} accessibilityLayer={false}>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="band"
            tickLine={false}
            axisLine={false}
            interval={narrow ? 1 : 0}
          />
          <YAxis allowDecimals={false} width={32} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="students" fill="var(--color-students)" radius={2} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Best score (%)</th>
            <th scope="col">Students</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band) => (
            <tr key={band.from}>
              <th scope="row">{bandLabel(band)}</th>
              <td>{band.students}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
