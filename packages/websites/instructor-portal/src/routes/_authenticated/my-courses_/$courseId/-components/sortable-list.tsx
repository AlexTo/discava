/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { cn } from '@discava/common-shadcn/lib/utils';
import { Accessibility, defaultPreset } from '@dnd-kit/dom';
import { move } from '@dnd-kit/helpers';
import {
  DragDropProvider,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/react';
import { isSortable, useSortable } from '@dnd-kit/react/sortable';
import { GripVertical } from 'lucide-react';
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert } from '../../../../../components/alert';

// What a sortable row hands its renderer: `ref` goes on the element that moves,
// `handleRef` on the grip that picks it up (see DragHandle).
export type SortableRow = {
  ref: (element: Element | null) => void;
  handleRef: (element: Element | null) => void;
  isDragging: boolean;
  disabled: boolean;
};

function SortableItem({
  id,
  index,
  disabled,
  children,
}: {
  id: string;
  index: number;
  disabled: boolean;
  children: (row: SortableRow) => ReactNode;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id, index, disabled });
  return children({ ref, handleRef, isDragging, disabled });
}

// The grip a row is dragged by. Being the handle, rather than the whole row,
// keeps the row's own buttons working; it can also be picked up with the
// keyboard (Space or Enter, then the arrow keys, then Space or Enter to drop,
// Escape to cancel).
export function DragHandle({
  row,
  title,
  size = 'sm',
  className,
}: {
  row: SortableRow;
  title: string;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  return (
    <Button
      ref={row.handleRef}
      type="button"
      variant="ghost"
      size={size === 'xs' ? 'icon-xs' : 'icon-sm'}
      aria-label={`Reorder ${title}`}
      disabled={row.disabled}
      className={cn(
        'cursor-grab touch-none text-muted-foreground hover:bg-transparent hover:text-foreground active:cursor-grabbing',
        className,
      )}
    >
      <GripVertical className={size === 'xs' ? 'size-3.5' : 'size-4'} />
    </Button>
  );
}

// The order once a row is dropped: the dragged row at the position it was
// sorted to. dnd-kit has already moved it there on screen while dragging, and
// the drop can end with no target (released just past the last row, say), in
// which case move() would leave the order as it was and nothing would be saved.
export const droppedOrder = (order: string[], event: DragEndEvent) => {
  const { source } = event.operation;
  if (!isSortable(source)) {
    return move(order, event);
  }
  const id = String(source.id);
  const next = order.filter((other) => other !== id);
  next.splice(source.index, 0, id);
  return next;
};

const errorCode = (error: unknown) =>
  (error as { data?: { code?: string } } | undefined)?.data?.code;

// A list the instructor reorders by dragging. The new order shows as soon as a
// row is dropped and is saved whole with `save`; on failure it snaps back and
// the error is shown, `conflictMessage` for a CONFLICT (the list changed under
// the editor, which `save` is expected to reload either way).
//
// Rows are only sortable when `sortable` is set and there are at least two;
// otherwise `renderItem` gets no row and should draw no handle.
export function SortableList<T>({
  items,
  getId,
  getTitle,
  sortable,
  save,
  errorHeader,
  conflictMessage,
  errorClassName,
  renderItem,
}: {
  items: T[];
  getId: (item: T) => string;
  getTitle: (item: T) => string;
  sortable: boolean;
  save: (ids: string[]) => Promise<unknown>;
  errorHeader: string;
  conflictMessage: string;
  // Wraps the error, so it lines up with the rows.
  errorClassName?: string;
  renderItem: (item: T, index: number, row?: SortableRow) => ReactNode;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  // dnd-kit moves the rows' DOM nodes itself while a row is dragged, so when a
  // save fails, putting the old order back in state isn't enough: React still
  // believes the nodes are where it last put them. Bumping this key rebuilds
  // the list from state instead.
  const [listKey, setListKey] = useState(0);

  // The order shown, which moves as soon as a row is dropped and follows the
  // course view whenever that changes.
  const ids = items.map(getId);
  const idsKey = ids.join(',');
  const [order, setOrder] = useState(ids);
  useEffect(() => setOrder(ids), [idsKey]);
  const byId = new Map(items.map((item) => [getId(item), item]));
  const ordered = order.flatMap((id) => byId.get(id) ?? []);

  // The announcements read the latest titles and order through a ref, so the
  // plugin list below can stay the same object across renders: the provider
  // reconfigures its plugins whenever that list changes, which would rebuild
  // the screen reader plugin mid-drag.
  const latest = useRef({ order, byId, getTitle });
  latest.current = { order, byId, getTitle };
  const plugins = useMemo(() => {
    type Source = DragStartEvent['operation']['source'];
    const titleOf = (source: Source) => {
      const item = latest.current.byId.get(String(source?.id));
      return item === undefined ? 'item' : latest.current.getTitle(item);
    };
    const count = () => latest.current.order.length;
    // Where the dragged row sits (1-based), now or when the drag started.
    const positionOf = (source: Source, initial = false) =>
      isSortable(source)
        ? (initial ? source.initialIndex : source.index) + 1
        : undefined;
    // What a screen reader hears, using titles rather than ids.
    return [
      ...defaultPreset.plugins.filter((plugin) => plugin !== Accessibility),
      Accessibility.configure({
        announcements: {
          dragstart: ({ operation: { source } }: DragStartEvent) =>
            `Picked up ${titleOf(source)}, position ${positionOf(source)} of ${count()}.`,
          dragover: ({ operation: { source } }: DragOverEvent) =>
            `${titleOf(source)} moved to position ${positionOf(source)} of ${count()}.`,
          dragend: ({ operation: { source }, canceled }: DragEndEvent) =>
            canceled
              ? `Moving ${titleOf(source)} was cancelled. It is back at position ${positionOf(source, true)} of ${count()}.`
              : `${titleOf(source)} dropped at position ${positionOf(source)} of ${count()}.`,
        },
      }),
    ];
  }, []);

  const onDragEnd = (event: DragEndEvent) => {
    if (event.canceled) {
      return;
    }
    const previous = order;
    const next = droppedOrder(order, event);
    if (next.join(',') === previous.join(',')) {
      return;
    }
    setOrder(next);
    setSaving(true);
    save(next)
      .catch((cause: unknown) => {
        setOrder(previous);
        setListKey((key) => key + 1);
        setError(
          errorCode(cause) === 'CONFLICT'
            ? conflictMessage
            : cause instanceof Error
              ? cause.message
              : String(cause),
        );
      })
      .finally(() => setSaving(false));
  };

  return (
    <>
      {!sortable || ordered.length < 2 ? (
        ordered.map((item, index) => (
          <Fragment key={getId(item)}>{renderItem(item, index)}</Fragment>
        ))
      ) : (
        <DragDropProvider
          key={listKey}
          plugins={plugins}
          onDragStart={() => setError(undefined)}
          onDragEnd={onDragEnd}
        >
          {ordered.map((item, index) => (
            <SortableItem
              key={getId(item)}
              id={getId(item)}
              index={index}
              disabled={saving}
            >
              {(row) => renderItem(item, index, row)}
            </SortableItem>
          ))}
        </DragDropProvider>
      )}
      {error && (
        <div className={errorClassName}>
          <Alert type="error" header={errorHeader}>
            {error}
          </Alert>
        </div>
      )}
    </>
  );
}
