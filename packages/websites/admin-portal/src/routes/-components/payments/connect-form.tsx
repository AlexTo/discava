/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { type RefObject, useRef, useState } from 'react';

// The secret key field. It is uncontrolled, so the key is never in a DOM
// attribute, and it is emptied as soon as the form is submitted, whatever the
// outcome.
export function KeyForm({
  submitLabel,
  pendingLabel,
  pending,
  disabled,
  keyFieldRef,
  onSubmit,
  onCancel,
}: {
  submitLabel: string;
  /** Shown on the submit button while the admin's own request runs. */
  pendingLabel: string;
  pending: boolean;
  /** The field and Cancel are unavailable, whoever's request is running. */
  disabled: boolean;
  /** So the screen can put focus in the field. */
  keyFieldRef?: RefObject<HTMLInputElement | null>;
  onSubmit: (secretKey: string) => void;
  onCancel?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [hasKey, setHasKey] = useState(false);

  return (
    <form
      className="max-w-md space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const field = input.current;
        const secretKey = field?.value.trim() ?? '';
        if (!field || secretKey === '' || disabled) {
          return;
        }
        field.value = '';
        setHasKey(false);
        onSubmit(secretKey);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="stripe-secret-key">Stripe secret key</Label>
        <Input
          id="stripe-secret-key"
          ref={(element) => {
            input.current = element;
            if (keyFieldRef) {
              keyFieldRef.current = element;
            }
          }}
          type="password"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => setHasKey(event.target.value.trim() !== '')}
        />
      </div>
      <div className="flex gap-2">
        <PendingButton
          type="submit"
          disabled={!hasKey}
          pending={pending}
          pendingLabel={pendingLabel}
        >
          {submitLabel}
        </PendingButton>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

// Where to find the key and what a restricted key needs.
export function KeyHelp() {
  return (
    <p className="max-w-md text-sm text-muted-foreground">
      In the Stripe dashboard, open Developers, then API keys, and copy a secret
      key (starting <code>sk_</code>) or create a restricted key (starting{' '}
      <code>rk_</code>). A restricted key needs write access to Checkout
      Sessions, Refunds and Webhook Endpoints, and read access to Accounts,
      Events and PaymentIntents.
    </p>
  );
}
