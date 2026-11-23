/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useState } from 'react';
import { ErrorAlert } from './error-alert';
import { LoadingState } from './loading-state';
import { Label } from './ui/label';
import { Switch } from './ui/switch';

export interface NotificationPreferenceRow {
  type: string;
  name: string;
  description: string;
  emailEnabled: boolean;
  // Always sent: the switch is on and can't be changed.
  required: boolean;
}

export interface NotificationPreferencesProps {
  preferences: NotificationPreferenceRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  // Saves one type's email setting; rejecting reverts the switch.
  onChange: (type: string, emailEnabled: boolean) => Promise<unknown>;
}

// The settings list: a row per notification type with an email switch. The
// portal supplies the rows and the save call; a switch shows its new value at
// once and goes back if the save fails.
export function NotificationPreferences({
  preferences,
  isLoading,
  isError,
  onRetry,
  onChange,
}: NotificationPreferencesProps) {
  // Values the user has just chosen, until the portal's rows catch up.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<string>();
  // The type whose save failed, with the sentence to show beside its switch.
  const [failure, setFailure] = useState<{ type: string; message: string }>();

  const change = async (type: string, emailEnabled: boolean) => {
    setSaved(undefined);
    setFailure(undefined);
    setPending((p) => ({ ...p, [type]: emailEnabled }));
    try {
      await onChange(type, emailEnabled);
      setSaved(type);
    } catch (error) {
      setFailure({
        type,
        message: `Couldn't save. ${apiErrorMessage(error)}`,
      });
    } finally {
      setPending((p) => {
        const { [type]: _done, ...rest } = p;
        return rest;
      });
    }
  };

  if (isLoading) {
    return <LoadingState label="Loading your notification settings…" />;
  }

  if (isError) {
    return (
      <ErrorAlert
        type="error"
        header="Couldn't load your notification settings"
        onRetry={onRetry}
      >
        Check your connection and try again.
      </ErrorAlert>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-lg border">
        {preferences.map((preference) => {
          const checked = preference.required
            ? true
            : (pending[preference.type] ?? preference.emailEnabled);
          const labelId = `notification-pref-${preference.type}`;
          const switchId = `${labelId}-switch`;
          return (
            <li
              key={preference.type}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <Label
                  htmlFor={switchId}
                  className="font-medium leading-normal"
                >
                  {preference.name}
                </Label>
                <p
                  id={`${labelId}-description`}
                  className="text-sm text-muted-foreground"
                >
                  {preference.description}
                </p>
                {failure?.type === preference.type ? (
                  <p
                    id={`${labelId}-error`}
                    role="alert"
                    className="mt-1 text-sm text-destructive"
                  >
                    {failure.message}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                {preference.required ? (
                  <span>Always on</span>
                ) : saved === preference.type ? (
                  <span role="status">Saved</span>
                ) : null}
                <Switch
                  id={switchId}
                  aria-describedby={
                    failure?.type === preference.type
                      ? `${labelId}-description ${labelId}-error`
                      : `${labelId}-description`
                  }
                  checked={checked}
                  disabled={preference.required}
                  onCheckedChange={(next) => change(preference.type, next)}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
