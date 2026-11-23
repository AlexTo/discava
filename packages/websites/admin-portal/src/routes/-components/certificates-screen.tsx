/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
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
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { useDiscardGuard } from '@discava/common-shadcn/hooks/use-discard-guard';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouterState, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../../api';
import { certificatesSearch } from '../-search';

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
  onDone,
  focusAfterClose,
}: {
  certificateId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Places focus after a success; returns true when it did. */
  focusAfterClose: (event: Event) => boolean;
}) {
  const returnFocus = useReturnFocus(open);
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const revoke = useMutation(trpc.certificate.revoke.mutationOptions());
  const [reason, setReason] = useState<Reason>('academic-integrity');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string>();
  const noteField = useRef<HTMLTextAreaElement>(null);

  const close = () => {
    setReason('academic-integrity');
    setNote('');
    setProblem(undefined);
    revoke.reset();
    onClose();
  };
  const guard = useDiscardGuard({ dirty: note.trim() !== '', discard: close });
  const submit = async () => {
    if (revoke.isPending) {
      return;
    }
    if (reason === 'other' && note.trim() === '') {
      setProblem('Enter a note to say why.');
      noteField.current?.focus();
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
    onDone();
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && guard.requestClose()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!focusAfterClose(event)) {
            returnFocus.onCloseAutoFocus(event);
          }
        }}
        {...guard.contentProps}
      >
        <form
          className="space-y-4"
          noValidate
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
              onChange={(event) => {
                setReason(event.target.value as Reason);
                setProblem(undefined);
              }}
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
                id="revoke-note-count"
                className="text-xs text-muted-foreground"
              >{`${note.length}/${NOTE_MAX}`}</span>
            </div>
            <Textarea
              id="revoke-note"
              ref={noteField}
              aria-invalid={Boolean(problem)}
              aria-describedby={`revoke-note-count${problem ? ' revoke-note-error' : ''}`}
              value={note}
              maxLength={NOTE_MAX}
              rows={3}
              onChange={(event) => {
                setNote(event.target.value);
                setProblem(undefined);
              }}
            />
            {problem && (
              <p id="revoke-note-error" className="text-sm text-destructive">
                {problem}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <PendingButton
              type="submit"
              variant="destructive"
              pending={revoke.isPending}
              pendingLabel="Revoking…"
            >
              Revoke certificate
            </PendingButton>
          </DialogFooter>
        </form>
        {guard.confirmation}
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  certificateId,
  open,
  onClose,
  onDone,
  focusAfterClose,
}: {
  certificateId: string;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** Places focus after a success; returns true when it did. */
  focusAfterClose: (event: Event) => boolean;
}) {
  const returnFocus = useReturnFocus(open);
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
    onDone();
    close();
    void queryClient.invalidateQueries(trpc.certificate.pathFilter());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        className="sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          if (!focusAfterClose(event)) {
            returnFocus.onCloseAutoFocus(event);
          }
        }}
      >
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
          <PendingButton
            type="button"
            pending={restore.isPending}
            pendingLabel="Restoring…"
            onClick={() => void submit()}
          >
            Restore certificate
          </PendingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Certificate({
  certificateId,
  onAnnounce,
}: {
  certificateId: string;
  onAnnounce: (message: string) => void;
}) {
  const trpc = useAdminApi();
  const [revoking, setRevoking] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const query = useQuery(
    trpc.certificate.get.queryOptions({ certificateId }, { retry: false }),
  );
  const revokeButton = useRef<HTMLButtonElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  // The button that replaces the one used, once the certificate has refetched.
  const focusNext = useRef<'revoke' | 'restore'>(undefined);
  const status = query.data?.status;

  const placeFocus = () => {
    const button = (
      focusNext.current === 'revoke' ? revokeButton : restoreButton
    ).current;
    if (focusNext.current && button) {
      focusNext.current = undefined;
      button.focus();
    }
  };
  useEffect(placeFocus, [status]);
  const focusAfterClose = (event: Event) => {
    if (!focusNext.current) {
      return false;
    }
    event.preventDefault();
    placeFocus();
    return true;
  };

  if (query.isPending) {
    return <LoadingState label="Looking up the certificate…" />;
  }
  if (query.isError) {
    const notFound = query.error.data?.code === 'NOT_FOUND';
    if (notFound) {
      return (
        <ErrorAlert type="info" header="No certificate has this ID">
          Check the ID against the certificate's page or PDF. IDs look like
          7V0Y-TKB5-6T6K-RPB3.
        </ErrorAlert>
      );
    }
    return (
      <ErrorAlert
        type="error"
        header="Couldn't look up the certificate"
        onRetry={() => query.refetch()}
      >
        {apiErrorMessage(query.error)}
      </ErrorAlert>
    );
  }
  const cert = query.data;

  return (
    <div className="space-y-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-full break-words sm:basis-0">
          <p className="font-medium">
            {cert.learnerName}{' '}
            {cert.status === 'revoked' ? (
              <Badge variant="outline">Revoked</Badge>
            ) : (
              <Badge variant="outline">Valid</Badge>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {cert.courseTitle} ·{' '}
            <span className="break-all">{cert.certificateId}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {`Completed ${date(cert.completedAt)} · Issued ${date(cert.issuedAt)}`}
          </p>
        </div>
        {cert.status === 'valid' ? (
          <Button
            ref={revokeButton}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRevoking(true)}
          >
            Revoke
          </Button>
        ) : (
          <Button
            ref={restoreButton}
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
          <ul className="space-y-2 text-sm">
            {cert.history.map((event) => (
              <li
                key={`${event.type}-${event.occurredAt}`}
                className="break-words"
              >
                {`${event.type === 'revoked' ? 'Revoked' : 'Restored'} on ${date(event.occurredAt)} by ${event.actorName}`}
                {event.reason ? `. Reason: ${reasonLabel(event.reason)}` : ''}
                {event.note ? '.' : ''}
                {event.note && (
                  <span className="block break-words">{`Note: ${event.note}`}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <RevokeDialog
        certificateId={certificateId}
        open={revoking}
        onClose={() => setRevoking(false)}
        onDone={() => {
          focusNext.current = 'restore';
          onAnnounce('Certificate revoked.');
        }}
        focusAfterClose={focusAfterClose}
      />
      <RestoreDialog
        certificateId={certificateId}
        open={restoring}
        onClose={() => setRestoring(false)}
        onDone={() => {
          focusNext.current = 'revoke';
          onAnnounce('Certificate restored.');
        }}
        focusAfterClose={focusAfterClose}
      />
    </div>
  );
}

/**
 * Look a certificate up by ID, then revoke or restore it whoever issued the
 * revocation, with its history.
 */
export function CertificatesScreen() {
  usePageTitle('Certificates');
  const lookedUp = useSearch({ from: '/certificates' }).id;
  const navigate = useNavigate({ from: '/certificates' });
  const address = useRouterState({ select: (state) => state.location.search });
  const [input, setInput] = useState(lookedUp ?? '');
  const [announcement, setAnnouncement] = useState('');
  const [problem, setProblem] = useState<string>();
  const idField = useRef<HTMLInputElement>(null);

  // An empty or over-long id, or one with spaces round it, is corrected in the
  // address, without adding a step to Back.
  useEffect(() => {
    const id = certificatesSearch(address).id;
    if ('id' in address && address.id !== id) {
      void navigate({ search: { id }, replace: true });
    }
  }, [address, navigate]);

  // Back and Forward change the id in the address; the field follows.
  useEffect(() => {
    setInput(lookedUp ?? '');
    setProblem(undefined);
  }, [lookedUp]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Certificates</h1>
        <p className="text-sm text-muted-foreground">
          Look up a certificate by its ID to revoke or restore it.
        </p>
      </header>
      <form
        className="max-w-xl space-y-2"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim() === '') {
            setProblem('Enter a certificate ID.');
            idField.current?.focus();
            return;
          }
          void navigate({ search: { id: input.trim() } });
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="certificate-id">Certificate ID</Label>
            <Input
              id="certificate-id"
              ref={idField}
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? 'certificate-id-error' : undefined}
              value={input}
              maxLength={100}
              onChange={(event) => {
                setInput(event.target.value);
                setProblem(undefined);
              }}
            />
          </div>
          <Button type="submit">Look up</Button>
        </div>
        {problem && (
          <p id="certificate-id-error" className="text-sm text-destructive">
            {problem}
          </p>
        )}
      </form>
      <StatusMessage message={announcement} visuallyHidden />
      {lookedUp && (
        <Certificate
          key={lookedUp}
          certificateId={lookedUp}
          onAnnounce={setAnnouncement}
        />
      )}
    </div>
  );
}
