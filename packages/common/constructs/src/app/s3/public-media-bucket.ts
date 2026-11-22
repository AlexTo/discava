/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  AllowedMethods,
  CachePolicy,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';
import { PublicBucket, PublicBucketProps } from '../../core/public-bucket.js';

export type PublicMediaBucketProps = Omit<
  PublicBucketProps,
  'runtimeConfigKey'
>;

/** The prefix the platform brand's images and `brand.json` live under. */
export const BRAND_PATH_PATTERN = 'brand/*';

// Media anyone may see, such as course display images (#76) and the platform
// brand (logo, icon, share image and the published brand.json).
export class PublicMediaBucket extends PublicBucket {
  constructor(scope: Construct, id: string, props?: PublicMediaBucketProps) {
    super(scope, id, {
      ...props,
      runtimeConfigKey: 'PublicMediaBucket',
    });

    // The portals fetch brand.json from another origin, so these objects
    // carry CORS headers; and because an admin uploads the SVG logos, a brand
    // object opened directly is sandboxed and can run nothing. Logos are shown
    // through <img>, which draws them without scripts whatever the headers.
    this.cloudFrontDistribution.addBehavior(BRAND_PATH_PATTERN, this.origin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      responseHeadersPolicy: new ResponseHeadersPolicy(
        this,
        'BrandResponseHeaders',
        {
          corsBehavior: {
            accessControlAllowOrigins: ['*'],
            accessControlAllowMethods: ['GET', 'HEAD'],
            accessControlAllowHeaders: ['*'],
            accessControlAllowCredentials: false,
            originOverride: true,
          },
          securityHeadersBehavior: {
            contentSecurityPolicy: {
              contentSecurityPolicy:
                "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
              override: true,
            },
            contentTypeOptions: { override: true },
          },
        },
      ),
    });
  }
}
