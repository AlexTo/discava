/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Duration } from 'aws-cdk-lib';
import {
  AllowedMethods,
  CachePolicy,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as url from 'url';
import { StaticWebsite, StaticWebsiteProps } from '../../core/index.js';
import { CoreApiPageRenderer } from '../lambda-functions/index.js';

/** What the student portal's page renderer needs to know. */
export interface PageRendererProps {
  /** Whether search engines may index the pages. */
  readonly allowSearchEngineIndexing: boolean;
  /** Shown in page titles and social cards. */
  readonly siteName: string;
  readonly reservedConcurrency: number;
  /**
   * The AppConfig application's name (`runtimeConfigApplicationName`), which
   * the renderer reads the table's name through. A name rather than an id,
   * since the application is in a stack that depends on this one.
   */
  readonly runtimeConfigAppName: string;
  /** The hosts pages may name as their own; empty allows `*.cloudfront.net`. */
  readonly allowedHosts: string[];
}

export type StudentPortalProps = Omit<
  StaticWebsiteProps,
  'websiteName' | 'websiteFilePath'
> & {
  /** Serve landing pages, instructor profiles, the site map and robots.txt from a Lambda. */
  readonly pageRenderer?: PageRendererProps;
};

// The paths the renderer answers; every other path is the static site.
const PAGE_RENDERER_PATHS = [
  '/learn/*',
  '/instructors/*',
  '/certificates/*',
  '/sitemap.xml',
  '/robots.txt',
];

export class StudentPortal extends StaticWebsite {
  /**
   * The renderer's role ARN, as a plain string. Not an `IGrantable`: a grant
   * made on this stack's role would put the policy here, referencing the
   * table and AppConfig of the Data stack, which depends on this one. The
   * Data stack imports the role by this ARN and grants on the import.
   */
  public readonly pageRendererRoleArn?: string;

  constructor(
    scope: Construct,
    id: string,
    { pageRenderer, ...props }: StudentPortalProps = {},
  ) {
    super(scope, id, {
      ...props,
      websiteName: 'StudentPortal',
      websiteFilePath: url.fileURLToPath(
        new URL(
          '../../../../../../dist/packages/websites/student-portal/bundle',
          import.meta.url,
        ),
      ),
    });

    if (!pageRenderer) {
      return;
    }

    const renderer = new CoreApiPageRenderer(this, 'PageRenderer', {
      reservedConcurrentExecutions: pageRenderer.reservedConcurrency,
      environment: {
        RUNTIME_CONFIG_APP_ID: pageRenderer.runtimeConfigAppName,
        WEBSITE_BUCKET: this.websiteBucket.bucketName,
        ALLOW_SEARCH_ENGINE_INDEXING: String(
          pageRenderer.allowSearchEngineIndexing,
        ),
        SITE_NAME: pageRenderer.siteName,
        ALLOWED_HOSTS: pageRenderer.allowedHosts.join(','),
      },
    });
    // The page template, and nothing else in the bucket.
    renderer.addToRolePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.websiteBucket.arnForObjects('index.html')],
      }),
    );
    this.websiteBucket.encryptionKey?.grantDecrypt(renderer);
    this.pageRendererRoleArn = renderer.role?.roleArn;

    const functionUrl = renderer.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
    });
    const origin = FunctionUrlOrigin.withOriginAccessControl(functionUrl);

    // Keyed on the path alone: no query, cookies or headers reach the cache
    // key, and the renderer gets only the viewer's host (`x-discava-host`), so
    // a response never depends on who asks. The renderer's `s-maxage` is
    // honoured, up to five minutes.
    const cachePolicy = new CachePolicy(this, 'PageRendererCachePolicy', {
      minTtl: Duration.seconds(0),
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(300),
    });
    const originRequestPolicy = new OriginRequestPolicy(
      this,
      'PageRendererOriginRequestPolicy',
      {
        headerBehavior: OriginRequestHeaderBehavior.allowList('x-discava-host'),
      },
    );
    const forwardHost = new CloudFrontFunction(this, 'ForwardHost', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({
        filePath: url.fileURLToPath(
          new URL('../../core/forward-host.js', import.meta.url),
        ),
      }),
    });
    for (const pathPattern of PAGE_RENDERER_PATHS) {
      this.cloudFrontDistribution.addBehavior(pathPattern, origin, {
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy,
        originRequestPolicy,
        responseHeadersPolicy: this.responseHeadersPolicy,
        // Instead of the SPA rewrite, which the default behavior has.
        functionAssociations: [
          {
            function: forwardHost,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      });
    }
  }
}
