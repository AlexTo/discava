/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPaymentStatus } from '@discava/admin-api';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import type { RefObject } from 'react';
import { formatWhen, keyEnding } from './format';

// The connected state: what is connected and the two things to do with it.
export function StatusCard({
  status,
  onReplace,
  onDisconnect,
  changing,
  busy,
  disconnecting,
  replaceRef,
}: {
  status: IPaymentStatus;
  onReplace: () => void;
  onDisconnect: () => void;
  /** A change is in progress, so neither button can be used. */
  changing: boolean;
  /** The admin's own request is running. */
  busy: boolean;
  disconnecting: boolean;
  replaceRef: RefObject<HTMLButtonElement | null>;
}) {
  const test = status.mode === 'test';
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Connected
          {status.mode && (
            <Badge
              variant={test ? 'outline' : 'secondary'}
              className={
                test
                  ? 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
                  : undefined
              }
            >
              {test ? 'Test mode' : 'Live mode'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {test && (
          <p className="text-amber-900 dark:text-amber-100">
            Students pay with test cards and are enrolled for free.
          </p>
        )}
        <div className="space-y-1">
          {status.accountName && <p>{status.accountName}</p>}
          {status.keyLast4 && <p>{keyEnding(status.keyLast4)}</p>}
          {status.changedByName && status.changedAt && (
            <p className="text-muted-foreground">
              {`Changed by ${status.changedByName} on ${formatWhen(status.changedAt)}`}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <PendingButton
            ref={replaceRef}
            variant="outline"
            disabled={changing}
            pending={busy}
            pendingLabel="Replace key"
            onClick={onReplace}
          >
            Replace key
          </PendingButton>
          <PendingButton
            variant="destructive"
            disabled={changing}
            pending={busy}
            pendingLabel={disconnecting ? 'Disconnecting…' : 'Disconnect'}
            onClick={onDisconnect}
          >
            Disconnect
          </PendingButton>
        </div>
      </CardContent>
    </Card>
  );
}
