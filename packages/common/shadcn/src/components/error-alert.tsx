/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertDescription, AlertTitle, Alert as ShadcnAlert } from './ui/alert';
import { Button } from './ui/button';

type ErrorAlertType = 'info' | 'error';

export interface ErrorAlertProps {
  type?: ErrorAlertType;
  header: React.ReactNode;
  children: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  type = 'info',
  header,
  children,
  onRetry,
  retryLabel = 'Try again',
}) => {
  const variant = type === 'error' ? 'destructive' : 'default';
  const role = type === 'error' ? 'alert' : 'status';

  return (
    <ShadcnAlert variant={variant} role={role}>
      <AlertTitle>{header}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      {onRetry && (
        // Alert is a grid whose first column is the (zero-width) icon slot;
        // the button goes in the content column, under the description.
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="col-start-2 mt-3 justify-self-start"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
    </ShadcnAlert>
  );
};
