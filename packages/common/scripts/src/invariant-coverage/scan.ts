/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import ts from 'typescript';
import type { WriterMap } from './check.js';

// Lists, for every core table entity, the files in each package that write
// it. A write is a call to put/create/upsert/patch/update/delete/remove on an
// ElectroDB entity: `coreTable.entities.course.patch(…)`, a destructured
// entity, or the entity a `transaction.write(({ course }) => […])` callback
// is given. Which entity it is comes from the type checker: the receiver's
// `schema.model.entity` is declared in that entity's file under
// core-table/src/entities, whatever the variable is called. (The name itself
// is typed as `string`, so it's read from the declaration.)

export const WORKSPACE_ROOT = path.resolve(
  import.meta.dirname,
  '../../../../..',
);

// The packages whose code writes the core table, by the name the map uses.
// The e2e suite and the CDK app aren't writers the rules have to hold for.
export const WRITER_PACKAGES: Record<string, string> = {
  'admin-api': 'packages/apis/admin-api',
  'common-scripts': 'packages/common/scripts',
  'core-api': 'packages/apis/core-api',
  'core-table': 'packages/databases/core-table',
  events: 'packages/events',
  'instructor-api': 'packages/apis/instructor-api',
  search: 'packages/databases/search',
};

const ENTITIES_DIR = path.join(
  WORKSPACE_ROOT,
  WRITER_PACKAGES['core-table'],
  'src/entities',
);

const WRITE_METHODS = new Set([
  'put',
  'create',
  'upsert',
  'patch',
  'update',
  'delete',
  'remove',
]);

// `entity: '<name>'` inside an entity file's `model: { … }`.
const entityNameOf = (node: ts.Node): string | undefined => {
  if (
    ts.isPropertyAssignment(node) &&
    node.name.getText() === 'entity' &&
    ts.isStringLiteral(node.initializer) &&
    ts.isObjectLiteralExpression(node.parent) &&
    ts.isPropertyAssignment(node.parent.parent) &&
    node.parent.parent.name.getText() === 'model' &&
    path.dirname(node.getSourceFile().fileName) === ENTITIES_DIR
  ) {
    return node.initializer.text;
  }
  return undefined;
};

// The entity a write's receiver is, or undefined when it isn't one (a Map's
// `delete`, tRPC's `create`, …).
const receiverEntities = (
  checker: ts.TypeChecker,
  receiver: ts.Expression,
): string[] => {
  const type = checker.getTypeAtLocation(receiver);
  const types = type.isUnion() ? type.types : [type];
  return types.flatMap((member) => {
    const schema = member.getProperty('schema');
    const model =
      schema &&
      checker.getTypeOfSymbolAtLocation(schema, receiver).getProperty('model');
    const entity =
      model &&
      checker.getTypeOfSymbolAtLocation(model, receiver).getProperty('entity');
    const name = entity?.declarations
      ?.map(entityNameOf)
      .find((found) => found !== undefined);
    return name ? [name] : [];
  });
};

const programFor = (packageDir: string): ts.Program => {
  const configPath = path.join(WORKSPACE_ROOT, packageDir, 'tsconfig.lib.json');
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (!config) {
    throw new Error(`Cannot read ${configPath}`);
  }
  return ts.createProgram(config.fileNames, config.options);
};

// Every entity's name, from its file, so one nothing writes is still listed.
const allEntities = (program: ts.Program): string[] =>
  program
    .getSourceFiles()
    .filter((file) => path.dirname(file.fileName) === ENTITIES_DIR)
    .flatMap((file) => {
      const names: string[] = [];
      const visit = (node: ts.Node) => {
        const name = entityNameOf(node);
        if (name) {
          names.push(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
      return names;
    });

export const scanEntityWriters = (): WriterMap => {
  const writes = new Map<string, Map<string, Set<string>>>();
  for (const [writer, packageDir] of Object.entries(WRITER_PACKAGES)) {
    const program = programFor(packageDir);
    const checker = program.getTypeChecker();
    if (writer === 'core-table') {
      for (const entity of allEntities(program)) {
        writes.set(entity, writes.get(entity) ?? new Map());
      }
    }
    const sourceRoot = path.join(WORKSPACE_ROOT, packageDir, 'src') + path.sep;
    for (const file of program.getSourceFiles()) {
      if (!file.fileName.startsWith(sourceRoot)) {
        continue;
      }
      const relative = path.relative(WORKSPACE_ROOT, file.fileName);
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          WRITE_METHODS.has(node.expression.name.text)
        ) {
          for (const entity of receiverEntities(
            checker,
            node.expression.expression,
          )) {
            const byWriter = writes.get(entity) ?? new Map();
            writes.set(entity, byWriter);
            const files = byWriter.get(writer) ?? new Set<string>();
            byWriter.set(writer, files);
            files.add(relative);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return sortWriterMap(
    Object.fromEntries(
      [...writes].map(([entity, byWriter]) => [
        entity,
        Object.fromEntries(
          [...byWriter].map(([writer, files]) => [writer, [...files]]),
        ),
      ]),
    ),
  );
};

// Keys and file lists in order, so the committed file only changes when a
// write does.
export const sortWriterMap = (map: WriterMap): WriterMap =>
  Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((entity) => [
        entity,
        Object.fromEntries(
          Object.keys(map[entity])
            .sort()
            .map((writer) => [writer, [...map[entity][writer]].sort()]),
        ),
      ]),
  );
