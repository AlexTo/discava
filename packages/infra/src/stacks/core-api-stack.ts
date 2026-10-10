/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminPortal,
  CoreApi,
  CoreTable,
  InstructorPortal,
  StudentPortal,
  suppressRules,
  UserIdentity,
} from '@discava/common-constructs';
import type { CoreApiComponentConfig } from '@discava/common-infra-config';
import { CfnResource, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';

export interface CoreApiStackProps extends StackProps {
  /** Settings for the core API construct. @default all enabled */
  readonly coreApi?: CoreApiComponentConfig;
  readonly identity: UserIdentity;
  readonly coreTable: CoreTable;
  /** Every portal calls core-api, so all three are allowed CORS origins. */
  readonly portals: [StudentPortal, InstructorPortal, AdminPortal];
}

/** The tRPC API any authenticated user can call. */
export class CoreApiStack extends Stack {
  public readonly coreApi: CoreApi<
    ReturnType<ReturnType<typeof CoreApi.defaultIntegrations>['build']>
  >;

  constructor(
    scope: Construct,
    id: string,
    {
      coreApi: coreApiConfig,
      identity,
      coreTable,
      portals,
      ...props
    }: CoreApiStackProps,
  ) {
    super(scope, id, props);

    const coreApiKmsEnabled = coreApiConfig?.enableKmsEncryption ?? true;
    const integrations = CoreApi.defaultIntegrations(this).build();
    const coreApiCertificate = coreApiConfig?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          'CoreApiCertificate',
          coreApiConfig.certificateArn,
        )
      : undefined;

    this.coreApi = new CoreApi(this, 'CoreApi', {
      integrations,
      identity,
      enableWaf: coreApiConfig?.enableWaf ?? true,
      enableKmsEncryption: coreApiKmsEnabled,
      enableKeyRotation: coreApiConfig?.enableKeyRotation ?? true,
      removalPolicy:
        (coreApiConfig?.retainOnDelete ?? true)
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
      domainName: coreApiConfig?.domainName,
      certificate: coreApiCertificate,
    });
    if (!coreApiKmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes('/CoreApi/AccessLogs'),
      );
    }

    Object.values(integrations).forEach(({ handler }) =>
      coreTable.grantReadWriteData(handler),
    );

    this.coreApi.restrictCorsTo(
      ...portals,
      'http://localhost:4200',
      'http://localhost:4300',
      'http://localhost:4201',
      'http://localhost:4301',
      'http://localhost:4202',
      'http://localhost:4302',
    );
  }
}
