/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AdminPortal,
  InstructorPortal,
  pageRendererParameterName,
  RuntimeConfig,
  StaticWebsite,
  StudentPortal,
  StudentPortalProps,
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
  readonly portalConfigScope: Construct;
}

/**
 * The three portals. Depends on nothing else in the stage; the API and data
 * stacks reference the portals' domains for CORS and Cognito callback URLs.
 */
export class WebsitesStack extends Stack {
  public readonly studentPortal: StudentPortal;
  public readonly instructorPortal: InstructorPortal;
  public readonly adminPortal: AdminPortal;
  /** Each portal's address: its first custom domain, else its CloudFront domain. */
  public readonly portalUrls: Record<
    'student' | 'instructor' | 'admin',
    string
  >;

  constructor(
    scope: Construct,
    id: string,
    {
      studentPortal,
      instructorPortal,
      adminPortal,
      portalConfigScope,
      ...props
    }: WebsitesStackProps,
  ) {
    super(scope, id, props);

    this.studentPortal = this.createPortal(
      StudentPortal,
      'StudentPortal',
      studentPortal,
      portalConfigScope,
      this.studentPortalProps(studentPortal),
    );
    // The LinkedIn page a certificate names when it's added to LinkedIn; the
    // issuer's name otherwise comes from the brand.
    const linkedInOrganizationId = studentPortal?.linkedInOrganizationId;
    RuntimeConfig.ensure(portalConfigScope).set('connection', 'site', {
      ...(linkedInOrganizationId && { linkedInOrganizationId }),
    });
    this.instructorPortal = this.createPortal(
      InstructorPortal,
      'InstructorPortal',
      instructorPortal,
      portalConfigScope,
    );
    this.adminPortal = this.createPortal(
      AdminPortal,
      'AdminPortal',
      adminPortal,
      portalConfigScope,
    );
    this.portalUrls = {
      student: this.portalUrl(this.studentPortal, studentPortal),
      instructor: this.portalUrl(this.instructorPortal, instructorPortal),
      admin: this.portalUrl(this.adminPortal, adminPortal),
    };
  }

  /**
   * The student portal's page renderer, and `noindex` on every response of a
   * stage closed to search engines.
   */
  private studentPortalProps(
    config: StudentPortalComponentConfig | undefined,
  ): Partial<StudentPortalProps> {
    const allowSearchEngineIndexing =
      config?.allowSearchEngineIndexing ?? false;
    return {
      ...(!allowSearchEngineIndexing && {
        extraResponseHeaders: { 'X-Robots-Tag': 'noindex' },
      }),
      pageRenderer: {
        allowSearchEngineIndexing,
        reservedConcurrency: config?.pageRendererReservedConcurrency ?? 20,
        settingsParameterName: pageRendererParameterName(this),
        allowedHosts: config?.domainNames ?? [],
      },
    };
  }

  private portalUrl(portal: StaticWebsite, config: PortalConfig | undefined) {
    return `https://${config?.domainNames?.[0] ?? portal.cloudFrontDistribution.distributionDomainName}`;
  }

  private createPortal<T extends StaticWebsite>(
    Portal: new (scope: Construct, id: string, props?: StudentPortalProps) => T,
    id: string,
    config: PortalConfig | undefined,
    portalConfigScope: Construct,
    extraProps: Partial<StudentPortalProps> = {},
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
      portalConfigScope,
      ...(kmsEnabled ? {} : { encryption: BucketEncryption.S3_MANAGED }),
      ...extraProps,
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

    // Every portal's address goes in every portal's runtime config, so one
    // can send people to another: e.g. a student who signs in to the
    // instructor portal is pointed to the student portal (#235).
    const runtimeConfig = RuntimeConfig.ensure(this);
    runtimeConfig.set('connection', 'portals', {
      ...runtimeConfig.get('connection').portals,
      [id]: this.portalUrl(portal, config),
    });

    return portal;
  }
}
