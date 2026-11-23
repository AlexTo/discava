/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { useUnsavedChangesGuard } from '@discava/common-shadcn/hooks/use-unsaved-changes-guard';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type Report = (section: string, dirty: boolean) => void;

const UnsavedChangesContext = createContext<Report | undefined>(undefined);

/**
 * Collects which sections of the course editor hold unsaved changes, and asks
 * "Leave without saving?" before the instructor leaves the page while any
 * does. With `enabled` false (an archived course) nothing is guarded.
 */
export function UnsavedChangesProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  const [dirtySections, setDirtySections] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const report = useCallback<Report>((section, dirty) => {
    setDirtySections((current) => {
      if (current.has(section) === dirty) {
        return current;
      }
      const next = new Set(current);
      if (dirty) {
        next.add(section);
      } else {
        next.delete(section);
      }
      return next;
    });
  }, []);
  const { confirmation } = useUnsavedChangesGuard(
    enabled && dirtySections.size > 0,
  );
  const value = useMemo(() => report, [report]);

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
      {confirmation}
    </UnsavedChangesContext.Provider>
  );
}

/**
 * Reports whether a section has unsaved changes, under a key of its own. A
 * section outside the provider reports to nobody.
 */
export function useReportUnsavedChanges(section: string, dirty: boolean) {
  const report = useContext(UnsavedChangesContext);
  useEffect(() => {
    report?.(section, dirty);
    return () => report?.(section, false);
  }, [report, section, dirty]);
}
