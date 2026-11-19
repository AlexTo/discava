/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState } from 'react';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
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

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? ` ${error.message}` : '';

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
  const [failure, setFailure] = useState<string>();

  const change = async (type: string, emailEnabled: boolean) => {
    setSaved(undefined);
    setFailure(undefined);
    setPending((p) => ({ ...p, [type]: emailEnabled }));
    try {
      await onChange(type, emailEnabled);
      setSaved(type);
    } catch (error) {
      setFailure(`Couldn't save.${messageOf(error)}`);
    } finally {
      setPending((p) => {
        const { [type]: _done, ...rest } = p;
        return rest;
      });
    }
  };

  if (isLoading) {
    return (
      <div aria-label="Loading notification settings" className="space-y-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="space-y-3 text-sm">
        <p>Couldn't load your notification settings.</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      <ul className="divide-y rounded-lg border">
        {preferences.map((preference) => {
          const checked = preference.required
            ? true
            : (pending[preference.type] ?? preference.emailEnabled);
          const labelId = `notification-pref-${preference.type}`;
          return (
            <li
              key={preference.type}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0">
                <p id={labelId} className="font-medium">
                  {preference.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {preference.description}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
                {preference.required ? (
                  <span>Always on</span>
                ) : saved === preference.type ? (
                  <span role="status">Saved</span>
                ) : null}
                <Switch
                  aria-labelledby={labelId}
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
