/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Stack, Stage } from 'aws-cdk-lib';
import { Construct } from 'constructs';

const RuntimeConfigKey = '__RuntimeConfig__';

/** The only namespace left: what the portals read from runtime-config.json. */
const PortalNamespace = 'connection';

/**
 * Stage-scoped singleton that collects the portals' `connection` settings
 * from CDK constructs and delivers them to the client side, as each portal's
 * `runtime-config.json` in S3. Server-side settings are not kept here: each
 * function gets its own as deploy-time settings (see `addSetting`).
 *
 * ```ts
 * RuntimeConfig.ensure(this).set('connection', 'cognitoProps', {
 *   region: '...',
 *   userPoolId: '...',
 * });
 * ```
 */
export class RuntimeConfig extends Construct {
  private readonly _namespaces = new Map<string, Record<string, any>>();

  static ensure(scope: Construct): RuntimeConfig {
    const parent = Stage.of(scope) ?? Stack.of(scope);
    return (
      RuntimeConfig.of(scope) ?? new RuntimeConfig(parent, RuntimeConfigKey)
    );
  }

  static of(scope: Construct): RuntimeConfig | undefined {
    const parent = Stage.of(scope) ?? Stack.of(scope);
    return parent.node.tryFindChild(RuntimeConfigKey) as
      | RuntimeConfig
      | undefined;
  }

  constructor(scope: Construct, id: string) {
    super(scope, id);
  }

  /** Sets a key in the `connection` namespace, the only one there is. */
  set(namespace: string, key: string, value: any): void {
    if (namespace !== PortalNamespace) {
      throw new Error(
        `RuntimeConfig only holds the portals' '${PortalNamespace}' settings, not '${namespace}'. Give a function its settings with addSetting.`,
      );
    }
    this.get(namespace)[key] = value;
  }

  /** Returns the config data for a namespace. Creates it if it doesn't exist. */
  get(namespace: string): Record<string, any> {
    let data = this._namespaces.get(namespace);
    if (!data) {
      data = {};
      this._namespaces.set(namespace, data);
    }
    return data;
  }
}
