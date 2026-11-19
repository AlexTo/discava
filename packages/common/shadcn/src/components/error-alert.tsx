/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AlertDescription, AlertTitle, Alert as ShadcnAlert } from './ui/alert';

type ErrorAlertType = 'info' | 'error';

export interface ErrorAlertProps {
  type?: ErrorAlertType;
  header: React.ReactNode;
  children: React.ReactNode;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  type = 'info',
  header,
  children,
}) => {
  const variant = type === 'error' ? 'destructive' : 'default';
  const role = type === 'error' ? 'alert' : 'status';

  return (
    <ShadcnAlert variant={variant} role={role}>
      <AlertTitle>{header}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </ShadcnAlert>
  );
};
