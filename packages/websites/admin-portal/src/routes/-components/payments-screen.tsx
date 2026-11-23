/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPaymentStatus } from '@discava/admin-api';
import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { LoadingState } from '@discava/common-shadcn/components/loading-state';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@discava/common-shadcn/components/ui/dialog';
import { usePageTitle } from '@discava/common-shadcn/hooks/use-page-title';
import { useReturnFocus } from '@discava/common-shadcn/hooks/use-return-focus';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useAdminApi } from '../../api';
import { ChangesTable } from './payments/changes-table';
import { KeyForm, KeyHelp } from './payments/connect-form';
import { StatusCard } from './payments/status-card';

export const POLL_MS = 5000;

// Connects, replaces and disconnects the Stripe account students pay into.
export function PaymentsScreen() {
  usePageTitle('Payments');
  const trpc = useAdminApi();
  const queryClient = useQueryClient();
  const statusOptions = trpc.payment.status.queryOptions(undefined, {
    refetchInterval: (query) =>
      query.state.data?.state === 'changing' ? POLL_MS : false,
  });
  const statusQuery = useQuery(statusOptions);
  const connect = useMutation(trpc.payment.connect.mutationOptions());
  const disconnect = useMutation(trpc.payment.disconnect.mutationOptions());
  const [replacing, setReplacing] = useState(false);
  // A replacement key waiting for the administrator to confirm. It lives in
  // memory only, never in the DOM.
  const [pendingKey, setPendingKey] = useState<string>();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [warning, setWarning] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const disconnectFocus = useReturnFocus(confirmingDisconnect);
  const replaceFocus = useReturnFocus(pendingKey !== undefined);
  const keyField = useRef<HTMLInputElement | null>(null);
  const replaceButton = useRef<HTMLButtonElement | null>(null);
  // Where focus goes once the screen has redrawn after an action.
  const [focusTarget, setFocusTarget] = useState<'key' | 'replace'>();
  // The screen has placed focus itself, so a closing dialog must not.
  const focusPlaced = useRef(false);

  const status = statusQuery.data;
  const busy = connect.isPending || disconnect.isPending;
  const changing = status?.state === 'changing';
  const error = connect.error ?? disconnect.error;

  useEffect(() => {
    if (!focusTarget) {
      return;
    }
    const target =
      focusTarget === 'key' ? keyField.current : replaceButton.current;
    // The key field is disabled while a request runs; wait for it.
    if (focusTarget === 'key' && target?.disabled) {
      return;
    }
    setFocusTarget(undefined);
    if (target) {
      target.focus();
      focusPlaced.current = true;
    }
  }, [focusTarget, busy]);
  const onCloseAutoFocus = (returnFocus: (event: Event) => void) => {
    return (event: Event) => {
      if (focusTarget || focusPlaced.current) {
        focusPlaced.current = false;
        event.preventDefault();
        return;
      }
      returnFocus(event);
    };
  };

  const show = (next: IPaymentStatus) => {
    queryClient.setQueryData(statusOptions.queryKey, next);
  };
  // A refused save may still have added a row to the recent changes.
  const reload = () =>
    void queryClient.invalidateQueries(trpc.payment.status.pathFilter());

  const save = async (secretKey: string) => {
    disconnect.reset();
    setWarning(undefined);
    try {
      const result = await connect.mutateAsync({ secretKey });
      setWarning(result.warning);
      setAnnouncement(replacing ? 'Key replaced.' : 'Stripe connected.');
      setReplacing(false);
      show(result);
      setFocusTarget('replace');
    } catch {
      // Shown in the alert.
      reload();
      setFocusTarget('key');
    }
  };

  const remove = async () => {
    setConfirmingDisconnect(false);
    connect.reset();
    setWarning(undefined);
    try {
      show(await disconnect.mutateAsync());
      setAnnouncement('Stripe disconnected.');
      setFocusTarget('key');
    } catch {
      reload();
    }
  };

  return (
    <section className="space-y-6">
      <h1 className="text-balance text-2xl font-bold tracking-tight">
        Payments
      </h1>

      <StatusMessage message={announcement} visuallyHidden />

      {statusQuery.isPending && (
        <LoadingState label="Loading the payment settings…" />
      )}
      {statusQuery.isError && (
        <ErrorAlert
          type="error"
          header="Couldn't load the payment settings"
          onRetry={() => statusQuery.refetch()}
        >
          {apiErrorMessage(statusQuery.error)}
        </ErrorAlert>
      )}

      {error && (
        <ErrorAlert type="error" header="Couldn't save the change">
          {apiErrorMessage(error)}
          {connect.error ? ' Enter the key again to retry.' : ''}
        </ErrorAlert>
      )}
      {warning && (
        <ErrorAlert header="Saved, with a warning">{warning}</ErrorAlert>
      )}

      {status && (
        <>
          {status.addressChanged && (
            <ErrorAlert header="Confirmation address changed">
              The address Stripe sends payment confirmations to has changed.
              Save the key again to register it.
            </ErrorAlert>
          )}

          {changing && (
            <ErrorAlert header="A change is in progress">
              This page refreshes every few seconds until it finishes.
            </ErrorAlert>
          )}

          {(status.state === 'active' || changing) && (
            <StatusCard
              status={status}
              changing={changing}
              busy={busy}
              disconnecting={disconnect.isPending}
              replaceRef={replaceButton}
              onReplace={() => setReplacing(true)}
              onDisconnect={() => {
                focusPlaced.current = false;
                setConfirmingDisconnect(true);
              }}
            />
          )}
          {status.state === 'active' && replacing && (
            <KeyForm
              submitLabel="Save key"
              pendingLabel="Saving…"
              pending={connect.isPending}
              disabled={busy}
              keyFieldRef={keyField}
              onSubmit={(key) => {
                focusPlaced.current = false;
                setPendingKey(key);
              }}
              onCancel={() => {
                setReplacing(false);
                setFocusTarget('replace');
              }}
            />
          )}

          {(status.state === 'not-connected' ||
            status.state === 'disconnected') && (
            <div className="space-y-3">
              <p className="text-sm">
                Stripe isn't connected. Students can't buy courses until it is.
              </p>
              <KeyForm
                submitLabel="Connect Stripe"
                pendingLabel="Connecting…"
                pending={connect.isPending}
                disabled={busy}
                keyFieldRef={keyField}
                onSubmit={(secretKey) => void save(secretKey)}
              />
              <KeyHelp />
            </div>
          )}

          <ChangesTable changes={status.changes} />
        </>
      )}

      <Dialog
        open={confirmingDisconnect}
        onOpenChange={(open) => !open && setConfirmingDisconnect(false)}
      >
        <DialogContent
          className="sm:max-w-lg"
          onCloseAutoFocus={onCloseAutoFocus(disconnectFocus.onCloseAutoFocus)}
        >
          <DialogHeader>
            <DialogTitle>Disconnect Stripe</DialogTitle>
            <DialogDescription>
              Students won't be able to buy courses until Stripe is connected
              again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDisconnect(false)}
            >
              Keep connected
            </Button>
            <Button variant="destructive" onClick={() => void remove()}>
              Disconnect Stripe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingKey !== undefined}
        onOpenChange={(open) => !open && setPendingKey(undefined)}
      >
        <DialogContent
          className="sm:max-w-lg"
          onCloseAutoFocus={onCloseAutoFocus(replaceFocus.onCloseAutoFocus)}
        >
          <DialogHeader>
            <DialogTitle>Replace the Stripe key</DialogTitle>
            <DialogDescription>
              {`If this key belongs to a different Stripe account than ${status?.accountName ?? 'the connected one'}, payments go to that account from now on. Continue?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingKey(undefined);
                setFocusTarget('key');
              }}
            >
              Keep the current key
            </Button>
            <Button
              onClick={() => {
                const key = pendingKey;
                setPendingKey(undefined);
                if (key) void save(key);
              }}
            >
              Replace the key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
