/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminApi,
  type AdminPortal,
  CoreTable,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type { AdminApiComponentConfig } from '@discava/common-infra-config';
import { localPortalOrigins } from '@discava/common-infra-config/local-portals';
import { CfnResource, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { apiLimits } from './api-limits.js';

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

    const adminApiKmsEnabled = adminApiConfig?.enableKmsEncryption ?? true;
    const limits = apiLimits(adminApiConfig);
    const integrations = AdminApi.defaultIntegrations(
      this,
      limits.functionOptions,
    ).build();
    const adminApiCertificate = adminApiConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'AdminApiCertificate',
          adminApiConfig.certificateArn,
        )
      : undefined;

    this.adminApi = new AdminApi(this, 'AdminApi', {
      integrations,
      identity,
      enableWaf: adminApiConfig?.enableWaf ?? true,
      throttle: limits.throttle,
      enableTracing: limits.enableTracing,
      enableKmsEncryption: adminApiKmsEnabled,
      enableKeyRotation: adminApiConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (adminApiConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: adminApiConfig?.domainName,
      certificate: adminApiCertificate,
    });
    if (!adminApiKmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes('/AdminApi/AccessLogs'),
      );
    }

    Object.values(integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    this.adminApi.restrictCorsTo(adminPortal, ...localPortalOrigins('admin'));
  }
}
