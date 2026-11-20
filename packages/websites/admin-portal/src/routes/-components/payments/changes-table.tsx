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
    <section className="space-y-2" aria-labelledby="recent-changes">
      <h2 id="recent-changes" className="text-lg font-semibold">
        Recent changes
      </h2>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">No changes yet.</p>
      ) : (
        <table className="w-full max-w-3xl text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">When</th>
              <th className="py-2 font-medium">Who</th>
              <th className="py-2 font-medium">What</th>
              <th className="py-2 font-medium">Mode</th>
              <th className="py-2 font-medium">Key</th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change) => (
              <tr key={`${change.at}-${change.kind}`} className="border-b">
                <td className="py-2">{formatWhen(change.at)}</td>
                <td className="py-2">{change.byName}</td>
                <td className="py-2">
                  {CHANGE_KIND[change.kind]}
                  {change.kind === 'failed' && change.step
                    ? `: ${FAILED_STEP[change.step]}`
                    : ''}
                </td>
                <td className="py-2">{change.mode ? MODE[change.mode] : ''}</td>
                <td className="py-2">
                  {change.keyLast4 ? `····${change.keyLast4}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
