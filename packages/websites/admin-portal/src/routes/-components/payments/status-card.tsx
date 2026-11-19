/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IPaymentStatus } from '@discava/admin-api';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@discava/common-shadcn/components/ui/card';
import { formatWhen, keyEnding } from './format';

// The connected state: what is connected and the two things to do with it.
export function StatusCard({
  status,
  onReplace,
  onDisconnect,
  disabled,
}: {
  status: IPaymentStatus;
  onReplace: () => void;
  onDisconnect: () => void;
  disabled: boolean;
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
          <Button variant="outline" disabled={disabled} onClick={onReplace}>
            Replace key
          </Button>
          <Button
            variant="destructive"
            disabled={disabled}
            onClick={onDisconnect}
          >
            Disconnect
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
