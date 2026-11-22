/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { Spinner } from '@discava/common-shadcn/components/ui/spinner';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAdminApi } from '../../api';

export const NOTE_MAX = 500;

type Reason = 'academic-integrity' | 'issued-in-error' | 'other' | 'refunded';

const REASONS: { value: Reason; label: string }[] = [
  { value: 'academic-integrity', label: 'Academic integrity' },
  { value: 'issued-in-error', label: 'Issued in error' },
  { value: 'refunded', label: 'Order refunded' },
  { value: 'other', label: 'Other' },
];

const reasonLabel = (reason: string | undefined) =>
  REASONS.find((r) => r.value === reason)?.label ?? 'Other';

const date = (iso: string) => new Date(iso).toLocaleDateString();

function RevokeDialog({
  certificateId,
  open,
  onClose,
}: {
  certificateId: string;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useAdminApi();
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
    if (revoke.isPending) {
      return;
    }
    try {
      await revoke.mutateAsync({
        certificateId,
        reason,
        ...(note.trim() !== '' && { note: note.trim() }),
      });
    } catch {
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
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
  certificateId,
  open,
  onClose,
}: {
  certificateId: string;
  open: boolean;
  onClose: () => void;
}) {
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const restore = useMutation(trpc.certificate.restore.mutationOptions());

  const close = () => {
    restore.reset();
    onClose();
  };
  const submit = async () => {
    if (restore.isPending) {
      return;
    }
    try {
      await restore.mutateAsync({ certificateId });
    } catch {
      return;
    }
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore certificate</DialogTitle>
          <DialogDescription>
            The certificate will be valid again, with the same ID, and the
            student will be told.
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

function Certificate({ certificateId }: { certificateId: string }) {
  const trpc = useAdminApi();
  const [revoking, setRevoking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const query = useQuery(
    trpc.certificate.get.queryOptions({ certificateId }, { retry: false }),
  );

  if (query.isPending) {
    return <Spinner />;
  }
  if (query.isError) {
    const notFound = query.error.data?.code === 'NOT_FOUND';
    return (
      <p role="alert" className="text-sm text-destructive">
        {notFound
          ? 'Certificate not found'
          : apiErrorMessage(query.error, "Couldn't look up the certificate.")}
      </p>
    );
  }
  const cert = query.data;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">
            {cert.learnerName}{' '}
            {cert.status === 'revoked' ? (
              <Badge variant="outline">Revoked</Badge>
            ) : (
              <Badge variant="outline">Valid</Badge>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {cert.courseTitle} · {cert.certificateId}
          </p>
          <p className="text-xs text-muted-foreground">
            {`Completed ${date(cert.completedAt)} · Issued ${date(cert.issuedAt)}`}
          </p>
        </div>
        {cert.status === 'valid' ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRevoking(true)}
          >
            Revoke
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRestoring(true)}
          >
            Restore
          </Button>
        )}
      </div>
      {cert.status === 'revoked' && cert.revokedAt && (
        <p className="text-sm">
          {`Revoked on ${date(cert.revokedAt)}: ${reasonLabel(cert.revocationReason)}`}
        </p>
      )}
      <div>
        <h2 className="text-sm font-medium">What it confirms</h2>
        <ul className="list-disc pl-5 text-sm">
          {cert.statement.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="text-sm font-medium">History</h2>
        {cert.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {cert.history.map((event) => (
              <li key={`${event.type}-${event.occurredAt}`}>
                {`${event.type === 'revoked' ? 'Revoked' : 'Restored'} on ${date(event.occurredAt)} by ${event.actorName}`}
                {event.reason ? `. Reason: ${reasonLabel(event.reason)}` : ''}
                {event.note ? `. Note: ${event.note}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
      <RevokeDialog
        certificateId={certificateId}
        open={revoking}
        onClose={() => setRevoking(false)}
      />
      <RestoreDialog
        certificateId={certificateId}
        open={restoring}
        onClose={() => setRestoring(false)}
      />
    </div>
  );
}

/**
 * Look a certificate up by ID, then revoke or restore it whoever issued the
 * revocation, with its history.
 */
export function CertificatesScreen() {
  const [input, setInput] = useState('');
  const [lookedUp, setLookedUp] = useState<string>();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Certificates</h1>
        <p className="text-sm text-muted-foreground">
          Look up a certificate by its ID to revoke or restore it.
        </p>
      </header>
      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() !== '') {
            setLookedUp(input.trim());
          }
        }}
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="certificate-id">Certificate ID</Label>
          <Input
            id="certificate-id"
            value={input}
            maxLength={100}
            onChange={(event) => setInput(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={input.trim() === ''}>
          Look up
        </Button>
      </form>
      {lookedUp && <Certificate key={lookedUp} certificateId={lookedUp} />}
    </div>
  );
}
