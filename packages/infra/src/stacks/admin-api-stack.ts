/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminApi,
  type AdminPortal,
  CoreTable,
  UserIdentity,
} from '@discava/common-constructs';
import type { AdminApiComponentConfig } from '@discava/common-infra-config';
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { trpcApiProps } from './trpc-api-props.js';

type AdminApiIntegrations = ReturnType<
  ReturnType<typeof AdminApi.defaultIntegrations>['build']
>;

export interface AdminApiStackProps extends StackProps {
  /** Settings for the admin API construct. @default all enabled */
  readonly adminApi?: AdminApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  /** The only portal that calls admin-api. */
  readonly adminPortal: AdminPortal;
}

/**
 * The tRPC API only administrators can call. It reads and writes the core
 * table (the category taxonomy) and needs nothing else.
 */
export class AdminApiStack extends Stack {
  public readonly adminApi: AdminApi<AdminApiIntegrations>;

  constructor(
    scope: Construct,
    id: string,
    {
      adminApi: adminApiConfig,
      identity,
      coreTable,
      adminPortal,
      ...props
    }: AdminApiStackProps,
  ) {
    super(scope, id, props);

    const {
      limits,
      props: apiProps,
      suppressLogGroupKmsRule,
    } = trpcApiProps(this, 'AdminApi', adminApiConfig);
    const integrations = AdminApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();

    this.adminApi = new AdminApi(this, 'AdminApi', {
      integrations,
      identity,
      ...apiProps,
    });
    suppressLogGroupKmsRule();

    Object.values(integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    this.adminApi.restrictCorsTo(adminPortal, ...localPortalOrigins('admin'));
  }
}
