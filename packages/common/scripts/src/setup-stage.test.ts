/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts/setup-stage.sh');
const REPOSITORY = 'AlexTo/discava';
const IMMUTABLE_PREFIX = 'repo:AlexTo@296212/discava@1340223666';

/**
 * How the stub `gh` answers the OIDC subject customization request. Stage
 * environment variables it reports as already set come from
 * GH_VARIABLE_<name>.
 */
type OidcSettings =
  | { kind: 'response'; useDefault: boolean; prefix?: string }
  | { kind: 'request-fails' }
  | { kind: 'no-gh' };

// Records every call and keeps each policy document it's handed, so tests can
// assert what the script would have sent to AWS without touching AWS. ACM
// answers come from ACM_CERTIFICATES (list-certificates rows, all of key type
// ACM_KEY_TYPE, default RSA_2048; ACM_CERTIFICATES_<region with underscores>
// takes its place for that region) and ACM_DESCRIBE (describe-certificate
// output), tab-separated like --output text. Like ACM, list-certificates only
// returns RSA_1024/RSA_2048 certificates unless --includes keyTypes says
// otherwise.
const AWS_STUB = `#!/usr/bin/env bash
echo "aws $*" >> "$OUT/calls.log"
case "$1 $2" in
  "sts get-caller-identity") echo "arn:aws:sts::111122223333:assumed-role/Admin/test"; exit;;
  "acm list-certificates")
    key_types="RSA_1024,RSA_2048" region=""
    for arg in "$@"; do
      case "$arg" in keyTypes=*) key_types="\${arg#keyTypes=}";; esac
      [[ "\${previous:-}" == --region ]] && region="$arg"
      previous="$arg"
    done
    regional_certificates="ACM_CERTIFICATES_\${region//-/_}"
    certificates="\${!regional_certificates:-\${ACM_CERTIFICATES:-}}"
    if [[ -n "$certificates" && ",$key_types," == *",\${ACM_KEY_TYPE:-RSA_2048},"* ]]; then
      printf '%b\\n' "$certificates"
    fi
    exit;;
  "acm describe-certificate") [[ -n "\${ACM_DESCRIBE:-}" ]] || { echo "ResourceNotFoundException" >&2; exit 254; }; printf '%b\\n' "$ACM_DESCRIBE"; exit;;
  "configure get") echo "ap-southeast-2"; exit;;
  "configure list-profiles") exit;;
  "ssm get-parameter") exit 0;;
  "iam get-open-id-connect-provider"|"iam get-role"|"iam get-policy") exit 1;;
esac
for arg in "$@"; do
  case "$arg" in file://*) cp "\${arg#file://}" "$OUT/";; esac
done
`;

const ghStub = (settings: OidcSettings): string => {
  const oidcResponse =
    settings.kind === 'response'
      ? `printf '%s\\t%s\\n' ${settings.useDefault} '${settings.prefix ?? ''}'; exit 0`
      : `echo "connection reset" >&2; exit 1`;
  return `#!/usr/bin/env bash
echo "gh $*" >> "$OUT/calls.log"
[[ "$1" == auth ]] && exit ${settings.kind === 'no-gh' ? 1 : 0}
if [[ "$*" == *actions/oidc/customization/sub* ]]; then ${oidcResponse}; fi
if [[ "$1" == api && "$2" == */variables/* ]]; then
  variable="GH_VARIABLE_\${2##*/}"
  [[ -z "\${!variable:-}" ]] || echo "\${!variable}"
fi
exit 0
`;
};

// Answers `git remote get-url origin` with ORIGIN_URL when that's set, and
// passes everything else to the real git.
const REAL_GIT = spawnSync('bash', ['-c', 'command -v git'], {
  encoding: 'utf8',
}).stdout.trim();
const GIT_STUB = `#!/usr/bin/env bash
if [[ -n "\${ORIGIN_URL+set}" && "$*" == *"remote get-url origin"* ]]; then
  [[ -n "$ORIGIN_URL" ]] && echo "$ORIGIN_URL"
  exit 0
fi
exec "${REAL_GIT}" "$@"
`;

const EXECUTION_POLICY_FILES = [
  'cfn-execution-discava-development.policy.json',
  'cfn-execution-discava-development-data.json',
  'cfn-execution-discava-development-edge.json',
  'cfn-execution-discava-development-compute.json',
];

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

const runSetup = (settings: OidcSettings, env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'setup-stage-'));
  tempDirs.push(dir);
  const bin = join(dir, 'bin');
  const out = join(dir, 'out');
  mkdirSync(bin);
  mkdirSync(out);
  writeFileSync(join(bin, 'aws'), AWS_STUB);
  writeFileSync(join(bin, 'gh'), ghStub(settings));
  writeFileSync(join(bin, 'git'), GIT_STUB);
  for (const stub of ['aws', 'gh', 'git']) chmodSync(join(bin, stub), 0o755);

  const result = spawnSync('bash', [SCRIPT, '--yes', 'discava-development'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      OUT: out,
      GITHUB_REPOSITORY: REPOSITORY,
      AWS_PROFILE: '',
      ...env,
    },
  });

  const calls = existsSync(join(out, 'calls.log'))
    ? readFileSync(join(out, 'calls.log'), 'utf8').split('\n')
    : [];
  const trustFile = join(out, 'github-deploy-discava-development.trust.json');
  const trustedSubject = existsSync(trustFile)
    ? JSON.parse(readFileSync(trustFile, 'utf8')).Statement[0].Condition
        .StringEquals['token.actions.githubusercontent.com:sub']
    : undefined;
  // The execution role's inline policy, then the managed policies attached
  // to it.
  const executionPolicies = EXECUTION_POLICY_FILES.filter((name) =>
    existsSync(join(out, name)),
  ).map((name) => JSON.parse(readFileSync(join(out, name), 'utf8')));
  return {
    status: result.status,
    // Whitespace-collapsed, since messages are wrapped to the terminal width.
    output: `${result.stdout}${result.stderr}`.replace(/\s+/g, ' '),
    iamCalls: calls.filter((call) => call.startsWith('aws iam ')),
    ghVariableCalls: calls.filter((call) => call.startsWith('gh variable ')),
    trustedSubject,
    executionPolicies,
    /** Every statement the execution role is granted, across its policies. */
    executionStatements: executionPolicies.flatMap(
      (policy) => policy.Statement,
    ),
    /** A policy document the script handed to AWS, by its file name. */
    policyDocument: (name: string) =>
      JSON.parse(readFileSync(join(out, name), 'utf8')),
  };
};

describe('setup-stage.sh OIDC subject', { timeout: 60_000 }, () => {
  it("trusts the repository's immutable subject prefix", () => {
    const { trustedSubject } = runSetup({
      kind: 'response',
      useDefault: true,
      prefix: IMMUTABLE_PREFIX,
    });

    expect(trustedSubject).toBe(
      `${IMMUTABLE_PREFIX}:environment:discava-development`,
    );
  });

  it('trusts repo:<owner>/<repo> when GitHub reports no prefix', () => {
    const { trustedSubject } = runSetup({ kind: 'response', useDefault: true });

    expect(trustedSubject).toBe(
      `repo:${REPOSITORY}:environment:discava-development`,
    );
  });

  it('stops before touching IAM when the settings request fails', () => {
    const { status, output, iamCalls, trustedSubject } = runSetup({
      kind: 'request-fails',
    });

    expect(status).not.toBe(0);
    expect(output).toContain("Couldn't read");
    expect(iamCalls).toEqual([]);
    expect(trustedSubject).toBeUndefined();
  });

  it('stops before touching IAM for a custom subject claim template', () => {
    const { status, output, iamCalls } = runSetup({
      kind: 'response',
      useDefault: false,
    });

    expect(status).not.toBe(0);
    expect(output).toContain('custom OIDC subject claim template');
    expect(iamCalls).toEqual([]);
  });

  it('warns and assumes the default prefix without an authenticated gh', () => {
    const { output, trustedSubject } = runSetup({ kind: 'no-gh' });

    expect(output).toContain('assuming the default prefix');
    expect(trustedSubject).toBe(
      `repo:${REPOSITORY}:environment:discava-development`,
    );
  });

  it('uses GITHUB_OIDC_SUBJECT_PREFIX without asking GitHub', () => {
    const { trustedSubject } = runSetup(
      { kind: 'request-fails' },
      { GITHUB_OIDC_SUBJECT_PREFIX: 'repo:someone/fork' },
    );

    expect(trustedSubject).toBe(
      'repo:someone/fork:environment:discava-development',
    );
  });
});

describe('setup-stage.sh repository', { timeout: 60_000 }, () => {
  const DEFAULT_OIDC: OidcSettings = { kind: 'response', useDefault: true };

  it.each([
    ['an HTTPS URL', 'https://github.com/AlexTo/discava.git'],
    ['an SSH URL', 'git@github.com:AlexTo/discava.git'],
    ['an SSH host alias', 'git@github.com-work:AlexTo/discava.git'],
  ])('trusts the origin remote’s repository, from %s', (_, url) => {
    const { trustedSubject, output } = runSetup(DEFAULT_OIDC, {
      GITHUB_REPOSITORY: '',
      ORIGIN_URL: url,
    });

    expect(trustedSubject).toBe(
      'repo:AlexTo/discava:environment:discava-development',
    );
    expect(output).toContain('Deploying from AlexTo/discava');
  });

  it('trusts GITHUB_REPOSITORY over the origin remote, e.g. for a fork', () => {
    const { trustedSubject } = runSetup(DEFAULT_OIDC, {
      GITHUB_REPOSITORY: 'someone/discava-fork',
      ORIGIN_URL: 'https://github.com/AlexTo/discava.git',
    });

    expect(trustedSubject).toBe(
      'repo:someone/discava-fork:environment:discava-development',
    );
  });

  it.each([
    ['isn’t on GitHub', 'https://gitlab.com/AlexTo/discava.git'],
    ['only looks like GitHub', 'https://notgithub.com/AlexTo/discava.git'],
    ['is missing', ''],
  ])('stops before touching IAM when origin %s', (_, url) => {
    const { status, output, iamCalls } = runSetup(DEFAULT_OIDC, {
      GITHUB_REPOSITORY: '',
      ORIGIN_URL: url,
    });

    expect(status).not.toBe(0);
    expect(output).toContain('set GITHUB_REPOSITORY=owner/repo');
    expect(iamCalls).toEqual([]);
  });
});

describe('setup-stage.sh execution policy', { timeout: 60_000 }, () => {
  it('allows tagging MediaConvert job templates as they are created', () => {
    // Tag-on-create is authorized against jobTemplates/*, not the template's
    // own ARN, so the stage-prefixed job template statement doesn't cover it.
    const { status, executionStatements } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(executionStatements).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: 'mediaconvert:TagResource',
        Resource:
          'arn:aws:mediaconvert:ap-southeast-2:111122223333:jobTemplates/*',
      }),
    );
  });

  it("allows vended log delivery from the stage's buckets", () => {
    // S3 server access logs reach CloudWatch Logs through a delivery source
    // on the bucket, which needs this on the bucket itself.
    const { status, executionStatements } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(executionStatements).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: expect.arrayContaining([
          's3:AllowVendedLogDeliveryForResource',
        ]),
        Resource: ['arn:aws:s3:::discava-development-*'],
      }),
    );
  });

  it("allows deleting the schedules left in the stage's schedule groups", () => {
    // Deleting a schedule group deletes its schedules first, each authorized
    // on the schedule itself rather than the group.
    const { status, executionStatements } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(executionStatements).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: 'scheduler:DeleteSchedule',
        Resource:
          'arn:aws:scheduler:ap-southeast-2:111122223333:schedule/discavadevelopment*/*',
      }),
    );
  });

  it("allows the stage's queues and its functions' event source mappings", () => {
    // The progress recalculation reads the core table's stream through an
    // event source mapping, whose ARN is a UUID, so it's scoped by the
    // function it invokes instead.
    const { status, executionStatements } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(executionStatements).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: expect.arrayContaining(['sqs:CreateQueue', 'sqs:DeleteQueue']),
        Resource:
          'arn:aws:sqs:ap-southeast-2:111122223333:discava-development-*',
      }),
    );
    expect(executionStatements).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: 'lambda:*EventSourceMapping',
        Resource: '*',
        Condition: {
          ArnLike: {
            'lambda:FunctionArn':
              'arn:aws:lambda:ap-southeast-2:111122223333:function:discava-development-*',
          },
        },
      }),
    );
  });

  it('fits each of its policies within the size IAM allows', () => {
    // Whitespace excluded, IAM allows 10,240 characters across a role's
    // inline policies and 6,144 per managed policy. The test account ID and
    // region are as long as real ones; discava-production's names are 1
    // character longer per stage-prefixed ARN, so leave room for that too.
    const { status, executionPolicies } = runSetup({
      kind: 'response',
      useDefault: true,
    });
    const [inline, ...managed] = executionPolicies.map(
      (policy) => JSON.stringify(policy).length,
    );

    expect(status).toBe(0);
    expect(managed).toHaveLength(3);
    expect(inline).toBeLessThanOrEqual(10_240 - 100);
    for (const size of managed) {
      expect(size).toBeLessThanOrEqual(6_144 - 100);
    }
  });

  it('attaches its managed policies to the execution role', () => {
    const { status, iamCalls } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    for (const group of ['data', 'edge', 'compute']) {
      expect(iamCalls).toContainEqual(
        expect.stringContaining(
          `aws iam attach-role-policy --role-name cfn-execution-discava-development --policy-arn arn:aws:iam::111122223333:policy/cfn-execution-discava-development-${group}`,
        ),
      );
    }
  });
});

describe('setup-stage.sh permissions boundary', { timeout: 60_000 }, () => {
  it("lets the stage's functions read table streams and send to its queues", () => {
    const { status, policyDocument } = runSetup({
      kind: 'response',
      useDefault: true,
    });
    const boundary = policyDocument(
      'permissions-boundary-discava-development.json',
    );

    expect(status).toBe(0);
    expect(boundary.Statement).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: expect.arrayContaining([
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
        ]),
        Resource:
          'arn:aws:dynamodb:ap-southeast-2:111122223333:table/discava-development-*',
      }),
    );
    expect(boundary.Statement).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: 'dynamodb:ListStreams',
        Resource: '*',
      }),
    );
    expect(boundary.Statement).toContainEqual(
      expect.objectContaining({
        Effect: 'Allow',
        Action: expect.arrayContaining(['sqs:SendMessage']),
        Resource:
          'arn:aws:sqs:ap-southeast-2:111122223333:discava-development-*',
      }),
    );
  });
});

describe('setup-stage.sh Docker login role', { timeout: 60_000 }, () => {
  const ROLE_NAME = 'github-docker-login-discava';

  it('lets any workflow in the repository assume it', () => {
    const { status, policyDocument } = runSetup({
      kind: 'response',
      useDefault: true,
      prefix: IMMUTABLE_PREFIX,
    });

    expect(status).toBe(0);
    expect(
      policyDocument(`${ROLE_NAME}.trust.json`).Statement[0].Condition,
    ).toEqual({
      StringEquals: {
        'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
      },
      StringLike: {
        'token.actions.githubusercontent.com:sub': `${IMMUTABLE_PREFIX}:*`,
      },
    });
  });

  it('only grants an ECR Public pull token', () => {
    const { status, policyDocument } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(policyDocument(`${ROLE_NAME}.policy.json`).Statement).toEqual([
      {
        Sid: 'EcrPublicAuthorizationToken',
        Effect: 'Allow',
        Action: 'ecr-public:GetAuthorizationToken',
        Resource: '*',
      },
      // Unconditioned: GetAuthorizationToken fails with AccessDenied on
      // GetServiceBearerToken under an sts:AWSServiceName condition.
      {
        Sid: 'EcrPublicBearerToken',
        Effect: 'Allow',
        Action: 'sts:GetServiceBearerToken',
        Resource: '*',
      },
    ]);
  });

  it('is created without a stage tag, since every stage shares it', () => {
    const { status, iamCalls } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    const createRole = iamCalls.find(
      (call) =>
        call.startsWith('aws iam create-role') &&
        call.includes(`--role-name ${ROLE_NAME} `),
    );
    expect(createRole).toContain('Key=Project,Value=discava');
    expect(createRole).not.toContain('Key=Stage');
  });

  it('stores its ARN as a repository variable', () => {
    const { status, ghVariableCalls } = runSetup({
      kind: 'response',
      useDefault: true,
    });

    expect(status).toBe(0);
    expect(ghVariableCalls).toContain(
      `gh variable set AWS_DOCKER_LOGIN_ROLE_ARN --repo ${REPOSITORY} --body arn:aws:iam::111122223333:role/${ROLE_NAME}`,
    );
  });
});

const CERTIFICATE_ARN =
  'arn:aws:acm:us-east-1:111122223333:certificate/11111111-2222-3333-4444-555555555555';
const REGIONAL_CERTIFICATE_ARN =
  'arn:aws:acm:ap-southeast-2:111122223333:certificate/66666666-7777-8888-9999-000000000000';
const GH_READY: OidcSettings = { kind: 'response', useDefault: true };

describe('setup-stage.sh custom domains', { timeout: 60_000 }, () => {
  it('sets no domain variables when no domains are configured', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY);

    expect(status).toBe(0);
    expect(ghVariableCalls.filter((call) => call.includes('DOMAIN'))).toEqual(
      [],
    );
  });

  it('stores a domain with the issued certificate found for it', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME: 'api.example.com',
      ACM_CERTIFICATES: `${REGIONAL_CERTIFICATE_ARN}\\t*.example.com,example.com`,
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\t*.example.com,example.com',
    });

    expect(status).toBe(0);
    expect(ghVariableCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME --repo ${REPOSITORY} --env discava-development --body api.example.com`,
    );
    expect(ghVariableCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_CORE_API_CERTIFICATE_ARN --repo ${REPOSITORY} --env discava-development --body ${REGIONAL_CERTIFICATE_ARN}`,
    );
  });

  it('finds ECDSA certificates, which ACM only lists when asked for', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME: 'api.example.com',
      ACM_CERTIFICATES: `${REGIONAL_CERTIFICATE_ARN}\\t*.example.com`,
      ACM_KEY_TYPE: 'EC_prime256v1',
      ACM_DESCRIBE: 'ISSUED\\tEC-prime256v1\\t*.example.com',
    });

    expect(status).toBe(0);
    expect(ghVariableCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_CORE_API_CERTIFICATE_ARN --repo ${REPOSITORY} --env discava-development --body ${REGIONAL_CERTIFICATE_ARN}`,
    );
  });

  it('rejects an RSA key over 2048 bits for an API', () => {
    const { status, output, iamCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME: 'api.example.com',
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_CERTIFICATE_ARN:
        REGIONAL_CERTIFICATE_ARN,
      ACM_DESCRIBE: 'ISSUED\\tRSA-4096\\t*.example.com',
    });

    expect(status).not.toBe(0);
    expect(output).toContain("doesn't support");
    expect(iamCalls).toEqual([]);
  });

  it('stops before touching IAM when no issued certificate covers a domain', () => {
    const { status, output, iamCalls, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME: 'api.example.com',
      ACM_CERTIFICATES: `${REGIONAL_CERTIFICATE_ARN}\\tother.example.org`,
    });

    expect(status).not.toBe(0);
    expect(output).toContain('No issued certificate');
    expect(iamCalls).toEqual([]);
    expect(ghVariableCalls).toEqual([]);
  });

  it('stores comma-separated CloudFront domains', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_STUDENT_PORTAL_DOMAIN_NAMES:
        'example.com, www.example.com',
      DISCAVA_DEVELOPMENT_INFRA_STUDENT_PORTAL_CERTIFICATE_ARN: CERTIFICATE_ARN,
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\texample.com,*.example.com',
    });

    expect(status).toBe(0);
    expect(ghVariableCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_STUDENT_PORTAL_DOMAIN_NAMES --repo ${REPOSITORY} --env discava-development --body example.com,www.example.com`,
    );
  });

  it('rejects a CloudFront certificate outside us-east-1 before touching IAM', () => {
    const { status, output, iamCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_LESSON_MEDIA_DOMAIN_NAMES: 'media.example.com',
      DISCAVA_DEVELOPMENT_INFRA_LESSON_MEDIA_CERTIFICATE_ARN:
        REGIONAL_CERTIFICATE_ARN,
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\t*.example.com',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('must be in us-east-1');
    expect(iamCalls).toEqual([]);
  });

  it("rejects a certificate that doesn't cover every domain", () => {
    const { status, output, iamCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_ADMIN_PORTAL_DOMAIN_NAMES:
        'admin.lms.example.com',
      DISCAVA_DEVELOPMENT_INFRA_ADMIN_PORTAL_CERTIFICATE_ARN: CERTIFICATE_ARN,
      // A wildcard covers exactly one label.
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\t*.example.com',
    });

    expect(status).not.toBe(0);
    expect(output).toContain("doesn't cover");
    expect(iamCalls).toEqual([]);
  });

  it('suggests a subdomain of the root domain for each component', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_ROOT_DOMAIN: 'Example.com',
      ACM_CERTIFICATES_ap_southeast_2: `${REGIONAL_CERTIFICATE_ARN}\\texample.com,*.example.com`,
      ACM_CERTIFICATES_us_east_1: `${CERTIFICATE_ARN}\\texample.com,*.example.com`,
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\texample.com,*.example.com',
    });

    expect(status).toBe(0);
    const set = (name: string, body: string) =>
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_${name} --repo ${REPOSITORY} --env discava-development --body ${body}`;
    expect(ghVariableCalls).toEqual(
      expect.arrayContaining([
        set('CORE_API_DOMAIN_NAME', 'core-api.example.com'),
        set('CORE_API_CERTIFICATE_ARN', REGIONAL_CERTIFICATE_ARN),
        set('INSTRUCTOR_API_DOMAIN_NAME', 'instructor-api.example.com'),
        set('INSTRUCTOR_API_CERTIFICATE_ARN', REGIONAL_CERTIFICATE_ARN),
        set('STUDENT_PORTAL_DOMAIN_NAMES', 'example.com,www.example.com'),
        set('STUDENT_PORTAL_CERTIFICATE_ARN', CERTIFICATE_ARN),
        set('INSTRUCTOR_PORTAL_DOMAIN_NAMES', 'instructor.example.com'),
        set('ADMIN_PORTAL_DOMAIN_NAMES', 'admin.example.com'),
        set('LESSON_MEDIA_DOMAIN_NAMES', 'lesson-media.example.com'),
        set('LESSON_MEDIA_CERTIFICATE_ARN', CERTIFICATE_ARN),
        set('LESSON_MEDIA_COOKIE_DOMAIN', 'example.com'),
      ]),
    );
  });

  it('keeps domains the stage config or GitHub already sets over the root domain', () => {
    const { status, ghVariableCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_ROOT_DOMAIN: 'example.com',
      DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME: 'api.example.com',
      GH_VARIABLE_DISCAVA_DEVELOPMENT_INFRA_ADMIN_PORTAL_DOMAIN_NAMES:
        'backoffice.example.com',
      ACM_CERTIFICATES_ap_southeast_2: `${REGIONAL_CERTIFICATE_ARN}\\t*.example.com,example.com`,
      ACM_CERTIFICATES_us_east_1: `${CERTIFICATE_ARN}\\t*.example.com,example.com`,
      ACM_DESCRIBE: 'ISSUED\\tRSA-2048\\t*.example.com,example.com',
    });

    expect(status).toBe(0);
    const domainCalls = ghVariableCalls.filter((call) =>
      call.includes('_DOMAIN_NAME'),
    );
    expect(domainCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_CORE_API_DOMAIN_NAME --repo ${REPOSITORY} --env discava-development --body api.example.com`,
    );
    expect(domainCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_ADMIN_PORTAL_DOMAIN_NAMES --repo ${REPOSITORY} --env discava-development --body backoffice.example.com`,
    );
    expect(domainCalls).toContain(
      `gh variable set DISCAVA_DEVELOPMENT_INFRA_INSTRUCTOR_PORTAL_DOMAIN_NAMES --repo ${REPOSITORY} --env discava-development --body instructor.example.com`,
    );
  });

  it('rejects an invalid root domain before touching IAM', () => {
    const { status, output, iamCalls } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_ROOT_DOMAIN: 'example_com',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('Not a valid domain name: example_com');
    expect(iamCalls).toEqual([]);
  });

  it('rejects more than one domain for an API', () => {
    const { status, output } = runSetup(GH_READY, {
      DISCAVA_DEVELOPMENT_INFRA_INSTRUCTOR_API_DOMAIN_NAME:
        'a.example.com,b.example.com',
    });

    expect(status).not.toBe(0);
    expect(output).toContain('takes a single domain');
  });
});
