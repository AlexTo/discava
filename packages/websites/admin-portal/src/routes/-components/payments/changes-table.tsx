/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CHANGE_KIND,
  FAILED_STEP,
  formatWhen,
  type PaymentChange,
} from './format';

const MODE = { test: 'Test', live: 'Live' };

// The last changes to the connection, newest first. Never more than the last
// four characters of a key.
export function ChangesTable({ changes }: { changes: PaymentChange[] }) {
  return (
    <section className="space-y-2">
      <h2 id="recent-changes" className="text-lg font-semibold">
        Recent changes
      </h2>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <div
          role="region"
          aria-labelledby="recent-changes"
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[36rem] max-w-3xl text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium first:pl-0 last:pr-0">
                  When
                </th>
                <th className="px-2 py-2 font-medium first:pl-0 last:pr-0">
                  Who
                </th>
                <th className="px-2 py-2 font-medium first:pl-0 last:pr-0">
                  What
                </th>
                <th className="px-2 py-2 font-medium first:pl-0 last:pr-0">
                  Mode
                </th>
                <th className="px-2 py-2 font-medium first:pl-0 last:pr-0">
                  Key
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={`${change.at}-${change.kind}`} className="border-b">
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums first:pl-0 last:pr-0">
                    {formatWhen(change.at)}
                  </td>
                  <td className="px-2 py-2 first:pl-0 last:pr-0">
                    {change.byName}
                  </td>
                  <td className="px-2 py-2 first:pl-0 last:pr-0">
                    {CHANGE_KIND[change.kind]}
                    {change.kind === 'failed' && change.step
                      ? `: ${FAILED_STEP[change.step]}`
                      : ''}
                  </td>
                  <td className="px-2 py-2 first:pl-0 last:pr-0">
                    {change.mode ? MODE[change.mode] : ''}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 first:pl-0 last:pr-0">
                    {change.keyLast4 ? `····${change.keyLast4}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
