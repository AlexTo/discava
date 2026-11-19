/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A stand-in for ElectroDB's Entity and Service, typed the way the scan reads
// them: the entity name is declared in `schema.model.entity`.
export class Entity<S extends { model: { entity: string } }> {
  constructor(readonly schema: S) {}
  put(_item: object) {
    return this;
  }
  patch(_key: object) {
    return this;
  }
  delete(_key: object) {
    return this;
  }
}

export const createService = <E extends object>(entities: E) => ({
  entities,
  transaction: {
    write: (writes: (entities: E) => unknown[]) => writes(entities),
  },
});
