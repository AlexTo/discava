/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TRPCError } from '@trpc/server';
import {
  MAX_TRANSACTION_ITEMS,
  type TransactionEntities,
  type TransactionItems,
} from './ancestor-writes.js';

export interface IReorderChildrenOptions<Child extends { order: number }> {
  // The new order of the parent's children, by id.
  ids: string[];
  // Every page of the parent's children that aren't archived.
  readActive: () => Promise<Child[]>;
  idOf: (child: Child) => string;
  // The transaction item that moves one child to `order`, conditioned on the
  // child still not being archived.
  patch: (
    entities: TransactionEntities,
    id: string,
    order: number,
  ) => TransactionItems[number];
  // Runs the patches in one transaction behind the checks on the parent's
  // ancestors (writeInActiveCourse or writeUnderActiveAncestors, bound to the
  // parent); calls `onChanged` when a patch fails its own condition.
  write: (
    writes: (entities: TransactionEntities) => TransactionItems,
    onChanged: () => never,
  ) => Promise<void>;
  // How many items the transaction carries besides the patches: the checks on
  // the ancestors.
  checkCount: number;
  duplicateMessage: string;
  tooManyMessage: (limit: number) => string;
  // Thrown when the ids aren't exactly the active children, or a child is
  // archived mid-reorder.
  changedError: () => TRPCError;
}

// Puts a parent's children in the given order, writing every `order` in one
// transaction. The ids have to be exactly the parent's active children, so a
// client that missed a child added, archived or removed in the meantime gets
// `changedError` and reloads rather than overwriting what it never saw.
// Repeating an order the parent already has writes nothing. Returns the
// children, as re-read after the write, in their new order.
export const reorderChildren = async <Child extends { order: number }>({
  ids,
  readActive,
  idOf,
  patch,
  write,
  checkCount,
  duplicateMessage,
  tooManyMessage,
  changedError,
}: IReorderChildrenOptions<Child>): Promise<Child[]> => {
  if (new Set(ids).size !== ids.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: duplicateMessage });
  }

  const children = await readActive();
  const byId = new Map(children.map((child) => [idOf(child), child]));
  if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
    throw changedError();
  }

  if (checkCount + ids.length > MAX_TRANSACTION_ITEMS) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: tooManyMessage(MAX_TRANSACTION_ITEMS - checkCount),
    });
  }

  const unchanged = ids.every((id, index) => byId.get(id)?.order === index + 1);
  if (!unchanged) {
    await write(
      (entities) => ids.map((id, index) => patch(entities, id, index + 1)),
      () => {
        throw changedError();
      },
    );
  }

  // Transactions don't return the written attributes.
  return (await readActive()).sort((a, b) => a.order - b.order);
};
