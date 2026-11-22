/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Use an AWS CLI profile from ~/.aws/config */
export type ProfileCredentials = {
  type: 'profile';
  /** AWS CLI profile name */
  profile: string;
};

/** Assume an IAM role via STS, optionally using a profile as the source credentials */
export type AssumeRoleCredentials = {
  type: 'assumeRole';
  /** IAM Role ARN to assume */
  assumeRole: string;
  /** Optional: AWS CLI profile to use as source credentials for the AssumeRole call */
  profile?: string;
  /** Optional: External ID required by the role's trust policy */
  externalId?: string;
  /** Optional: Session duration in seconds (default: 3600). Increase for long deployments. */
  sessionDuration?: number;
};

/**
 * Credentials for deploying to a specific CDK stage.
 * The `type` field determines which credential strategy is used.
 */
export type StageCredentials = ProfileCredentials | AssumeRoleCredentials;

/** The lowest level a function logs at, as AWS Lambda Powertools reads it. */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Per-stage settings for the Cognito user pool / identity construct.
 */
export type IdentityComponentConfig = {
  /** Protect the Cognito user pool with AWS WAF */
  enableWaf?: boolean;
  /** Require MFA on the Cognito user pool */
  enableMfa?: boolean;
  /** Prevent the user pool from being deleted while the stack is deployed */
  enableDeletionProtection?: boolean;
  /**
   * Retain the user pool (and every user in it) when the stack is deleted,
   * instead of destroying it along with the stack.
   *
   * @default true
   */
  retainOnDelete?: boolean;
  /**
   * Let anyone create an account from the sign-in page. When off, only an
   * administrator can create users, so bots can't sign themselves up (Cognito
   * charges per monthly active user above its free tier).
   *
   * @default true
   */
  enableSelfSignUp?: boolean;
};

/**
 * Per-stage settings for the core API construct.
 */
export type CoreApiComponentConfig = {
  /** Protect the API Gateway with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper AWS-owned default for the access log group */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the access log group's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Custom domain name for the API Gateway REST API. Requires `certificateArn`. */
  domainName?: string;
  /** ACM certificate ARN for the custom domain name. Must be in the same region as the API. */
  certificateArn?: string;
  /**
   * Retain the API's access log group (and its KMS key, if any) when the
   * stack is deleted, instead of destroying it along with the stack.
   *
   * @default true
   */
  retainOnDelete?: boolean;
  /**
   * Requests per second API Gateway lets through on average to each method
   * (API Gateway throttles every method separately, so the API's ceiling is
   * this times its number of methods). Above it callers get 429 Too Many
   * Requests, before any Lambda runs, which bounds what a flood can cost.
   *
   * @default 100
   */
  throttleRateLimit?: number;
  /**
   * Requests API Gateway lets through at once to each method, in a burst
   * above `throttleRateLimit`.
   *
   * @default 200
   */
  throttleBurstLimit?: number;
  /**
   * How many requests each of the API's Lambda functions handles at once
   * (reserved concurrency). Requests beyond it are rejected instead of
   * scaling out, which caps the Lambda, DynamoDB and logging cost of a flood.
   * Reserved from the account's concurrency, which must keep 100 unreserved.
   *
   * @default no reservation: the function scales with the account's limit
   */
  reservedConcurrency?: number;
  /**
   * How long a request may run before Lambda stops it, in seconds.
   *
   * @default 30
   */
  timeoutSeconds?: number;
  /**
   * The lowest log level the API's functions write (POWERTOOLS_LOG_LEVEL).
   * CloudWatch Logs charges per GB ingested, so WARN keeps a busy stage's
   * logs, and a flood's, small.
   *
   * @default 'INFO'
   */
  logLevel?: LogLevel;
  /**
   * Trace requests with AWS X-Ray, on the API Gateway stage and the
   * functions. X-Ray charges per trace recorded.
   *
   * @default true
   */
  enableTracing?: boolean;
  /**
   * Requests per second API Gateway lets through to each operation anyone
   * may call without signing in (every operation in core-api's
   * PUBLIC_OPERATIONS, and the unsubscribe route): the only ones a bot can
   * reach without an account. `course.publicSuggest` has its own limit,
   * `publicSuggestThrottleRateLimit`.
   *
   * @default 20
   */
  publicThrottleRateLimit?: number;
  /**
   * Requests API Gateway lets through at once in a burst above
   * `publicThrottleRateLimit`, per public operation.
   *
   * @default 40
   */
  publicThrottleBurstLimit?: number;
  /**
   * Requests per second API Gateway lets through to `course.publicSuggest`,
   * the search box's suggestions. They fire on every typing pause, so they
   * have a limit of their own, shared by every caller.
   *
   * @default 100
   */
  publicSuggestThrottleRateLimit?: number;
  /**
   * Requests API Gateway lets through at once in a burst above
   * `publicSuggestThrottleRateLimit`, shared by every caller.
   *
   * @default 200
   */
  publicSuggestThrottleBurstLimit?: number;
};

/**
 * Per-stage settings for the instructor API construct.
 */
export type InstructorApiComponentConfig = {
  /** Protect the API Gateway with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper AWS-owned default for the access log group */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the access log group's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Custom domain name for the API Gateway REST API. Requires `certificateArn`. */
  domainName?: string;
  /** ACM certificate ARN for the custom domain name. Must be in the same region as the API. */
  certificateArn?: string;
  /**
   * Retain the API's access log group (and its KMS key, if any) when the
   * stack is deleted, instead of destroying it along with the stack.
   *
   * @default true
   */
  retainOnDelete?: boolean;
  /**
   * Requests per second API Gateway lets through on average to each method
   * (API Gateway throttles every method separately, so the API's ceiling is
   * this times its number of methods). Above it callers get 429 Too Many
   * Requests, before any Lambda runs, which bounds what a flood can cost.
   *
   * @default 100
   */
  throttleRateLimit?: number;
  /**
   * Requests API Gateway lets through at once to each method, in a burst
   * above `throttleRateLimit`.
   *
   * @default 200
   */
  throttleBurstLimit?: number;
  /**
   * How many requests each of the API's Lambda functions handles at once
   * (reserved concurrency). Requests beyond it are rejected instead of
   * scaling out, which caps the Lambda, DynamoDB and logging cost of a flood.
   * Reserved from the account's concurrency, which must keep 100 unreserved.
   *
   * @default no reservation: the function scales with the account's limit
   */
  reservedConcurrency?: number;
  /**
   * How long a request may run before Lambda stops it, in seconds.
   *
   * @default 30
   */
  timeoutSeconds?: number;
  /**
   * The lowest log level the API's functions write (POWERTOOLS_LOG_LEVEL).
   * CloudWatch Logs charges per GB ingested, so WARN keeps a busy stage's
   * logs, and a flood's, small.
   *
   * @default 'INFO'
   */
  logLevel?: LogLevel;
  /**
   * Trace requests with AWS X-Ray, on the API Gateway stage and the
   * functions. X-Ray charges per trace recorded.
   *
   * @default true
   */
  enableTracing?: boolean;
};

/**
 * Per-stage settings for the core DynamoDB table construct.
 */
export type CoreTableComponentConfig = {
  /** Use customer-managed KMS encryption instead of the cheaper AWS-owned default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the table's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Prevent the table from being deleted while the stack is deployed */
  enableDeletionProtection?: boolean;
  /**
   * Retain the table (and its KMS key, if any) when the stack is deleted,
   * instead of destroying it and all its data along with the stack.
   *
   * @default true
   */
  retainOnDelete?: boolean;
  /**
   * The most read request units per second the table (and each of its
   * indexes) serves on demand. Reads beyond it are throttled, which puts a
   * ceiling on what reads can cost. Too low also throttles legitimate
   * traffic, including the progress recalculation's reads.
   *
   * @default no maximum
   */
  maxReadRequestUnits?: number;
  /**
   * The most write request units per second the table (and each of its
   * indexes) serves on demand; beyond it writes are throttled.
   *
   * @default no maximum
   */
  maxWriteRequestUnits?: number;
};

/**
 * Per-stage settings for the stream router: the queues (and the KMS key)
 * that carry the core table's changes to each feature's handler.
 */
export type StreamRouterComponentConfig = {
  /** Use customer-managed KMS encryption instead of the cheaper SQS-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the queues' KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
};

/**
 * Per-stage settings for the student portal static website construct.
 */
export type StudentPortalComponentConfig = {
  /** Protect the CloudFront distribution with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper S3-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the website bucket's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Custom domain names for the CloudFront distribution. Requires `certificateArn`. */
  domainNames?: string[];
  /** ACM certificate ARN for the custom domain names. Must be in us-east-1. */
  certificateArn?: string;
  /** Let search engines index the public pages. Default `false`. When off, every response carries `noindex` */
  allowSearchEngineIndexing?: boolean;
  /** The stage's LinkedIn organisation page ID (digits). When set, certificates added to LinkedIn name that page; otherwise the platform name (set on the admin portal's Branding page) is sent as text */
  linkedInOrganizationId?: string;
  /** Reserved concurrency for the page renderer Lambda. Default `20` */
  pageRendererReservedConcurrency?: number;
};

/**
 * Per-stage settings for the instructor portal static website construct.
 */
export type InstructorPortalComponentConfig = {
  /** Protect the CloudFront distribution with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper S3-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the website bucket's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Custom domain names for the CloudFront distribution. Requires `certificateArn`. */
  domainNames?: string[];
  /** ACM certificate ARN for the custom domain names. Must be in us-east-1. */
  certificateArn?: string;
};

/**
 * Per-stage settings for the admin portal static website construct.
 */
export type AdminPortalComponentConfig = {
  /** Protect the CloudFront distribution with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper S3-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the website bucket's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Custom domain names for the CloudFront distribution. Requires `certificateArn`. */
  domainNames?: string[];
  /** ACM certificate ARN for the custom domain names. Must be in us-east-1. */
  certificateArn?: string;
};

/**
 * Per-stage settings for the lesson media S3 buckets: the CloudFront-served
 * bucket (transcoded output) and the raw-upload bucket. Both share all of
 * these flags, including `retainOnDelete`.
 */
export type LessonMediaComponentConfig = {
  /** Protect the CloudFront distribution in front of the bucket with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper S3-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the bucket's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /**
   * Retain both lesson media buckets when the stack is deleted, instead of
   * destroying them (and auto-deleting their contents) along with the
   * stack. Mainly meaningful for the CloudFront-served bucket, which holds
   * the actual served content; the raw-upload bucket's own lifecycle rule
   * already clears its contents within days regardless of this setting, so
   * retaining it protects little in practice.
   *
   * @default false
   */
  retainOnDelete?: boolean;
  /**
   * Custom domain names for the CloudFront distribution in front of the
   * CloudFront-served bucket. Requires `certificateArn`. Not applicable to
   * the raw-upload bucket, which has no CloudFront distribution.
   */
  domainNames?: string[];
  /** ACM certificate ARN for the custom domain names. Must be in us-east-1. */
  certificateArn?: string;
  /**
   * `Domain=` attribute for the CloudFront signed cookies issued when a
   * student or instructor plays back a video's HLS output. Must be a shared
   * parent domain of `domainNames` here and of the APIs that issue these
   * cookies, `coreApi.domainName` and `instructorApi.domainName` (e.g.
   * `example.com` when those are `lesson-media.example.com`,
   * `api.example.com` and `instructor-api.example.com`): a cookie can only
   * be set for the issuing domain or one of its parents. Required for HLS
   * playback to work at all: the
   * manifest, rendition playlists, and segments are separate CloudFront
   * requests that only a cookie (not a signed URL) can authorize
   * uniformly. See https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-choosing-signed-urls-cookies.html
   */
  cookieDomain?: string;
};

/**
 * Per-stage settings for the OpenSearch Serverless search collection (#53).
 */
export type SearchComponentConfig = {
  /** Use customer-managed KMS encryption instead of the cheaper AWS-owned default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the collection's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /**
   * The collection group's indexing/search capacity floor, in OCUs. 0 is
   * true scale-to-zero (no cost while idle, a ~10-30s cold start on the
   * first request after one); a non-zero minimum keeps that much capacity
   * always warm, avoiding that latency at a small continuous cost.
   *
   * @default 0
   */
  minIndexingCapacityInOcu?: number;
  minSearchCapacityInOcu?: number;
  /**
   * The collection group's indexing/search capacity ceiling, in OCUs.
   *
   * @default 4
   */
  maxIndexingCapacityInOcu?: number;
  maxSearchCapacityInOcu?: number;
  /**
   * Retain the collection (and its KMS key, if any) when the stack is
   * deleted, instead of destroying it and all its indices along with the
   * stack.
   *
   * @default true
   */
  retainOnDelete?: boolean;
};

/**
 * Per-stage settings for the public media bucket: media anyone may see, such
 * as course display images, served through CloudFront without signing.
 */
export type PublicMediaComponentConfig = {
  /** Protect the CloudFront distribution in front of the bucket with AWS WAF */
  enableWaf?: boolean;
  /** Use customer-managed KMS encryption instead of the cheaper S3-managed default */
  enableKmsEncryption?: boolean;
  /** Enable automatic key rotation on the bucket's KMS key. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /**
   * Retain the bucket when the stack is deleted, instead of destroying it
   * (and auto-deleting its contents) along with the stack.
   *
   * @default false
   */
  retainOnDelete?: boolean;
  /** Custom domain names for the CloudFront distribution. Requires `certificateArn`. */
  domainNames?: string[];
  /** ACM certificate ARN for the custom domain names. Must be in us-east-1. */
  certificateArn?: string;
};

/**
 * Per-stage settings for notification emails. Both are account-specific, so
 * they are set through env vars rather than committed. With neither set, the
 * delivery function has no sender, is granted no SES access, and records each
 * email as skipped (`not-configured`).
 */
export type NotificationsComponentConfig = {
  /** Address notification emails are sent from, e.g. `notifications@example.com`. Must belong to `sesIdentity` */
  fromAddress?: string;
  /** SES identity (a verified domain or address) the delivery function may send from. The grant covers only this identity */
  sesIdentity?: string;
};

/**
 * Per-stage settings for the admin API construct, which takes the same
 * settings as the instructor API.
 */
export type AdminApiComponentConfig = InstructorApiComponentConfig;

/**
 * Per-stage settings for the Stripe webhook API (`POST /stripe/webhook`),
 * which Stripe calls without a Cognito token: the WAF and throttling are what
 * stand in front of it. Fully hardened by default.
 */
export type PaymentsComponentConfig = {
  /** Protect the API with AWS WAF's default managed ruleset */
  enableWaf?: boolean;
  /** Encrypt the API's access log group with a customer-managed KMS key */
  enableKmsEncryption?: boolean;
  /** Rotate that key every year. Only used when `enableKmsEncryption` is true */
  enableKeyRotation?: boolean;
  /** Retain the access log group when the stack is deleted */
  retainOnDelete?: boolean;
  /** Custom domain name for the API. Requires `certificateArn` */
  domainName?: string;
  /** ACM certificate ARN for the custom domain. Must be in the stage's region */
  certificateArn?: string;
  /** Requests per second API Gateway lets through to the webhook method */
  throttleRateLimit?: number;
  /** Burst allowed above that rate */
  throttleBurstLimit?: number;
  /** Concurrent executions reserved for the webhook function */
  reservedConcurrency?: number;
  /** The webhook function's timeout, in seconds */
  timeoutSeconds?: number;
  /** The webhook function's log level */
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  /** Trace requests with AWS X-Ray */
  enableTracing?: boolean;
};

/**
 * Component-level settings consuming apps use to configure their constructs
 * per stage, keyed by component name. Omitted components/flags fall back to
 * whatever default the app itself chooses.
 */
export type StageComponents = {
  identity?: IdentityComponentConfig;
  coreApi?: CoreApiComponentConfig;
  instructorApi?: InstructorApiComponentConfig;
  adminApi?: AdminApiComponentConfig;
  payments?: PaymentsComponentConfig;
  coreTable?: CoreTableComponentConfig;
  streamRouter?: StreamRouterComponentConfig;
  studentPortal?: StudentPortalComponentConfig;
  instructorPortal?: InstructorPortalComponentConfig;
  adminPortal?: AdminPortalComponentConfig;
  lessonMedia?: LessonMediaComponentConfig;
  publicMedia?: PublicMediaComponentConfig;
  search?: SearchComponentConfig;
  notifications?: NotificationsComponentConfig;
};

/**
 * Per-stage instructor payout settings: what the platform keeps, how long
 * instructor earnings are held, and the smallest payout sent. Checked by
 * `validatePayoutSettings` whenever a stage is resolved.
 */
export type PayoutSettings = {
  /**
   * The platform's fee on each sale, in basis points of the amount paid
   * (100 basis points = 1%). An integer from 0 to 10000 inclusive.
   * Applies to sales recorded after a change; earlier ones keep the fee they
   * were recorded with.
   *
   * @default 2000
   */
  platformFeeBasisPoints: number;
  /**
   * Days a sale's earnings are held before the instructor can be paid for
   * them, to cover the refund window. A non-negative integer.
   *
   * @default 14
   */
  holdDays: number;
  /**
   * The smallest payout the daily run sends, in minor units of the currency
   * (cents for USD). Smaller balances wait for the next run. A non-negative
   * integer.
   *
   * @default 1000
   */
  minimumPayoutMinor: number;
};

/** Machine translation of video captions, which Amazon Translate bills per character. */
export type CaptionTranslationSettings = {
  /**
   * Whether the stage translates captions at all. When false, no course's
   * caption languages are translated and no translated track is removed.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * The most caption languages one course can choose, from 0 to 9. Each
   * language multiplies the characters translated per video, so it bounds
   * the translation cost.
   *
   * @default 9
   */
  maxLanguagesPerCourse?: number;
};

/**
 * Configuration for a single CDK stage.
 * Credentials/region/account are optional — omit them to fall back to the
 * active AWS CLI/environment credentials (see resolveStage).
 */
export type StageConfig = {
  /** How to authenticate when deploying this stage. Omit to use environment/CLI credentials. */
  credentials?: StageCredentials;
  /** AWS region for this stage (e.g., 'us-east-1'). Omit to use CDK_DEFAULT_REGION. */
  region?: string;
  /** AWS account ID. If omitted, CDK infers it from the active credentials. */
  account?: string;
  /** Infrastructure (construct) settings for this stage */
  infra?: StageComponents;
  /** Instructor payout settings for this stage */
  payouts?: PayoutSettings;
  /** Caption translation settings for this stage */
  captionTranslation?: CaptionTranslationSettings;
};

/**
 * Configuration for a single infrastructure project.
 * The key in the parent map is the project path relative to workspace root
 * (e.g., 'packages/infra').
 */
export type ProjectConfig = {
  /** Map of CDK stage names to their configuration */
  stages: { [stageName: string]: StageConfig };
};

/** Top-level configuration mapping projects and stages to their settings. */
export type StagesConfig = {
  /** Project-specific config. Key is the project path relative to workspace root. */
  projects?: { [projectPath: string]: ProjectConfig };
  /** Shared stage config available to all projects. */
  shared?: {
    stages: { [stageName: string]: StageConfig };
  };
};
