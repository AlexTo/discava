/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

export const NOTE_MAX = 500;

type Reason = 'academic-integrity' | 'issued-in-error' | 'other';

const REASONS: { value: Reason; label: string }[] = [
  { value: 'academic-integrity', label: 'Academic integrity' },
  { value: 'issued-in-error', label: 'Issued in error' },
  { value: 'other', label: 'Other' },
];

const reasonLabel = (reason: string | undefined) =>
  reason === 'refunded'
    ? 'Order refunded'
    : (REASONS.find((r) => r.value === reason)?.label ?? 'Other');

const date = (iso: string) => new Date(iso).toLocaleDateString();

interface Row {
  certificateId: string;
  learnerName: string;
  status: 'valid' | 'revoked';
  revokedAt?: string;
  revocationReason?: string;
  revokedByRole?: 'instructor' | 'admin';
  canRestore: boolean;
}

// Asks for a reason, then revokes. A failed call keeps the dialog open with
// what was typed.
function RevokeDialog({
  courseId,
  row,
  onClose,
}: {
  courseId: string;
  row: Row | undefined;
  onClose: () => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const revoke = useMutation(trpc.certificate.revoke.mutationOptions());
  const [reason, setReason] = useState<Reason>('academic-integrity');
  const [note, setNote] = useState('');

  const close = () => {
    setReason('academic-integrity');
    setNote('');
    revoke.reset();
    onClose();
  };
  const submit = async () => {
    if (!row || revoke.isPending) {
      return;
    }
    try {
      await revoke.mutateAsync({
        courseId,
        certificateId: row.certificateId,
        reason,
        ...(note.trim() !== '' && { note: note.trim() }),
      });
    } catch {
      // Shown in the dialog.
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={row !== undefined} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Revoke certificate</DialogTitle>
            <DialogDescription>
              The public page will say this certificate has been revoked, and
              the student will be told.
            </DialogDescription>
          </DialogHeader>

          {revoke.isError && (
            <ErrorAlert type="error" header="Couldn't revoke the certificate">
              {apiErrorMessage(revoke.error)}
            </ErrorAlert>
          )}

          <div className="space-y-2">
            <Label htmlFor="revoke-reason">Reason</Label>
            <select
              id="revoke-reason"
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value as Reason)}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="revoke-note">Note</Label>
              <span
                className="text-xs text-muted-foreground"
                aria-live="polite"
              >{`${note.length}/${NOTE_MAX}`}</span>
            </div>
            <Textarea
              id="revoke-note"
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={
                revoke.isPending || (reason === 'other' && note.trim() === '')
              }
            >
              {revoke.isPending ? 'Revoking…' : 'Revoke certificate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  courseId,
  row,
  onClose,
}: {
  courseId: string;
  row: Row | undefined;
  onClose: () => void;
}) {
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const restore = useMutation(trpc.certificate.restore.mutationOptions());

  const close = () => {
    restore.reset();
    onClose();
  };
  const submit = async () => {
    if (!row || restore.isPending) {
      return;
    }
    try {
      await restore.mutateAsync({
        courseId,
        certificateId: row.certificateId,
      });
    } catch {
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={row !== undefined} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore certificate</DialogTitle>
          <DialogDescription>
            {`${row?.learnerName ?? 'The student'}'s certificate will be valid again, with the same ID, and the student will be told.`}
          </DialogDescription>
        </DialogHeader>
        {restore.isError && (
          <ErrorAlert type="error" header="Couldn't restore the certificate">
            {apiErrorMessage(restore.error)}
          </ErrorAlert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={restore.isPending}
            onClick={() => void submit()}
          >
            {restore.isPending ? 'Restoring…' : 'Restore certificate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function History({
  courseId,
  certificateId,
}: {
  courseId: string;
  certificateId: string;
}) {
  const trpc = useInstructorApi();
  const query = useQuery(
    trpc.certificate.history.queryOptions({ courseId, certificateId }),
  );

  if (query.isPending) {
    return <Spinner />;
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(query.error, "Couldn't load the history.")}
      </p>
    );
  }
  if (query.data.length === 0) {
    return <p className="text-sm text-muted-foreground">No history.</p>;
  }
  return (
    <ul className="space-y-1 text-sm">
      {query.data.map((event) => (
        <li key={`${event.type}-${event.occurredAt}`}>
          {`${event.type === 'revoked' ? 'Revoked' : 'Restored'} on ${date(event.occurredAt)} by ${event.actorName}`}
          {event.reason ? `. Reason: ${reasonLabel(event.reason)}` : ''}
          {event.note ? `. Note: ${event.note}` : ''}
        </li>
      ))}
    </ul>
  );
}

const statusText = (row: Row) =>
  row.status === 'revoked'
    ? `Revoked on ${row.revokedAt ? date(row.revokedAt) : ''}: ${reasonLabel(row.revocationReason)}`
    : 'Valid';

/**
 * The course's certificates, newest first: revoke one, restore one the
 * instructor revoked, and read what happened to it.
 */
export function CourseCertificatesList({ courseId }: { courseId: string }) {
  const trpc = useInstructorApi();
  const [revoking, setRevoking] = useState<Row>();
  const [restoring, setRestoring] = useState<Row>();
  const [open, setOpen] = useState<string>();
  const query = useInfiniteQuery(
    trpc.certificate.list.infiniteQueryOptions(
      { courseId },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-3">
      <h3 className="font-medium">Issued certificates</h3>
      {query.isPending && <Spinner />}
      {query.isError && (
        <div role="alert" className="space-y-3 text-sm">
          <p className="text-destructive">
            {apiErrorMessage(query.error, "Couldn't load the certificates.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
          >
            Try again
          </Button>
        </div>
      )}
      {query.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">No certificates yet</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Learner</th>
                <th className="p-3 font-medium">Certificate ID</th>
                <th className="p-3 font-medium">Completed</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((item) => (
                <tr key={item.certificateId} className="align-top">
                  <td className="p-3">{item.learnerName}</td>
                  <td className="p-3 font-mono">{item.certificateId}</td>
                  <td className="p-3">{date(item.completedAt)}</td>
                  <td className="p-3">
                    <p>{statusText(item)}</p>
                    {item.status === 'revoked' &&
                      item.revokedByRole === 'admin' && (
                        <p className="text-muted-foreground">
                          Revoked by an administrator
                        </p>
                      )}
                    {open === item.certificateId && (
                      <div className="mt-2">
                        <History
                          courseId={courseId}
                          certificateId={item.certificateId}
                        />
                      </div>
                    )}
                  </td>
                  <td className="space-x-2 p-3 text-right whitespace-nowrap">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${open === item.certificateId ? 'Hide' : 'Show'} history for ${item.learnerName}`}
                      onClick={() =>
                        setOpen(
                          open === item.certificateId
                            ? undefined
                            : item.certificateId,
                        )
                      }
                    >
                      {open === item.certificateId ? 'Hide history' : 'History'}
                    </Button>
                    {item.status === 'valid' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Revoke ${item.learnerName}'s certificate`}
                        onClick={() => setRevoking(item)}
                      >
                        Revoke
                      </Button>
                    )}
                    {item.status === 'revoked' && item.canRestore && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Restore ${item.learnerName}'s certificate`}
                        onClick={() => setRestoring(item)}
                      >
                        Restore
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <Button
          variant="outline"
          onClick={() => query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
        >
          Load more
        </Button>
      )}
      <RevokeDialog
        courseId={courseId}
        row={revoking}
        onClose={() => setRevoking(undefined)}
      />
      <RestoreDialog
        courseId={courseId}
        row={restoring}
        onClose={() => setRestoring(undefined)}
      />
    </section>
  );
}
