/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminPortal,
  InstructorPortal,
  StaticWebsite,
  StaticWebsiteProps,
  StudentPortal,
  suppressRules,
} from '@discava/common-constructs';
import type {
  AdminPortalComponentConfig,
  InstructorPortalComponentConfig,
  StudentPortalComponentConfig,
} from '@discava/common-infra-config';
import { CfnResource, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

type PortalConfig =
  | StudentPortalComponentConfig
  | InstructorPortalComponentConfig
  | AdminPortalComponentConfig;

export interface WebsitesStackProps extends StackProps {
  /** Settings for the student portal static website construct. @default all enabled */
  readonly studentPortal?: StudentPortalComponentConfig;
  /** Settings for the instructor portal static website construct. @default all enabled */
  readonly instructorPortal?: InstructorPortalComponentConfig;
  /** Settings for the admin portal static website construct. @default all enabled */
  readonly adminPortal?: AdminPortalComponentConfig;
  /**
   * Where each portal's runtime-config.json deployment goes. It embeds API
   * URLs and Cognito ids, and the APIs depend on this stack for their CORS
   * origins, so it can't live here.
   */
  readonly runtimeConfigScope: Construct;
}

/**
 * The three portals. Depends on nothing else in the stage; the API and data
 * stacks reference the portals' domains for CORS and Cognito callback URLs.
 */
export class WebsitesStack extends Stack {
  public readonly studentPortal: StudentPortal;
  public readonly instructorPortal: InstructorPortal;
  public readonly adminPortal: AdminPortal;

  constructor(
    scope: Construct,
    id: string,
    {
      studentPortal,
      instructorPortal,
      adminPortal,
      runtimeConfigScope,
      ...props
    }: WebsitesStackProps,
  ) {
    super(scope, id, props);

    this.studentPortal = this.createPortal(
      StudentPortal,
      'StudentPortal',
      studentPortal,
      runtimeConfigScope,
    );
    this.instructorPortal = this.createPortal(
      InstructorPortal,
      'InstructorPortal',
      instructorPortal,
      runtimeConfigScope,
    );
    this.adminPortal = this.createPortal(
      AdminPortal,
      'AdminPortal',
      adminPortal,
      runtimeConfigScope,
    );
  }

  private createPortal<T extends StaticWebsite>(
    Portal: new (
      scope: Construct,
      id: string,
      props?: Omit<StaticWebsiteProps, 'websiteName' | 'websiteFilePath'>,
    ) => T,
    id: string,
    config: PortalConfig | undefined,
    runtimeConfigScope: Construct,
  ): T {
    const wafEnabled = config?.enableWaf ?? true;
    const kmsEnabled = config?.enableKmsEncryption ?? true;
    const certificate = config?.certificateArn
      ? Certificate.fromCertificateArn(
          this,
          `${id}Certificate`,
          config.certificateArn,
        )
      : undefined;

    const portal = new Portal(this, id, {
      enableWaf: wafEnabled,
      enableKeyRotation: config?.enableKeyRotation ?? true,
      domainNames: config?.domainNames,
      certificate,
      runtimeConfigScope,
      ...(kmsEnabled ? {} : { encryption: BucketEncryption.S3_MANAGED }),
    });
    if (!wafEnabled) {
      suppressRules(
        portal.cloudFrontDistribution,
        ['CKV_AWS_68'],
        'WAF disabled for this stage',
      );
    }
    if (!kmsEnabled) {
      suppressRules(
        this,
        ['CKV_AWS_158'],
        'KMS encryption disabled for this stage',
        (c) =>
          CfnResource.isCfnResource(c) &&
          c.cfnResourceType === 'AWS::Logs::LogGroup' &&
          c.node.path.includes(`/${id}/AccessLogs`),
      );
    }

    return portal;
  }
}
