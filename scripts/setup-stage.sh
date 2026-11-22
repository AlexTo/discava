#!/usr/bin/env bash

#
# Copyright Discava Contributors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
#
set -euo pipefail

# Written for bash 3.2, the /bin/bash macOS ships: no mapfile, associative
# arrays or ${var,,}, and an empty array is expanded as ${a[@]+"${a[@]}"},
# since bash before 4.4 treats "${a[@]}" of an empty array as unset under
# set -u.

# lower <text>: prints text lowercased.
lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# Guided deployment setup for a Discava stage.
#
# Run this once per deployment stage (as defined in
# packages/common/infra-config/src/stages.config.ts), from a clone of the
# repository that will run the deploy workflow — your fork, if you forked. It
# prompts for everything it needs, defaulting each answer to what it can detect
# (press Enter to accept), then:
# - creates the GitHub OIDC provider (shared by every stage in the account)
# - creates or updates the GitHub deploy role assumed by the workflow
# - creates or updates the CloudFormation execution role passed to
#   `cdk deploy --role-arn`, and the managed policies attached to it
# - creates or updates the repository's Docker login role (shared by every
#   stage), which CI assumes only to authenticate image pulls from Amazon ECR
#   Public, whose anonymous pulls shared GitHub runner IPs can rate-limit
# - creates or updates the stage's permissions boundary policy, which every
#   role the execution role creates must carry
# - optionally bootstraps CDK in the regions the stage deploys to
# - optionally creates the matching GitHub environment and sets its variables,
#   plus the repository's AWS_DOCKER_LOGIN_ROLE_ARN variable (requires an
#   authenticated `gh` CLI)
# - optionally serves every component from a subdomain of one root domain,
#   using the issued ACM certificate it finds for each (stopping if one is
#   missing), with the root as HLS playback's signed-cookie domain, and
#   notification emails sent as notifications@<root> when the root is a
#   verified SES domain identity in the stage's region; stored as
#   <STAGE>_INFRA_<COMPONENT>_* variables on that GitHub environment (see
#   packages/common/infra-config/src/env-overrides.ts), which the deploy
#   workflow forwards to synth
#
# Stages may share an AWS account, so each stage gets its own pair of roles,
# and the deploy role trusts only the GitHub environment of the same name.
# The deploy role can only publish to the stage's own asset prefix, and the
# execution role can only create roles bounded by the stage's permissions
# boundary, so one stage's deploys can't reach another stage's assets or
# resources beyond what that boundary allows.
#
# Usage:
#   pnpm install   # the stage list and settings are read from stages.config.ts
#   ./scripts/setup-stage.sh [--yes] [stage]
#
#   --yes   accept every default without prompting (for scripted runs)
#
# Defaults can be preset with environment variables:
#   GITHUB_REPOSITORY    owner/repo trusted by the deploy role, e.g. a fork
#                        you deploy from (otherwise taken from the `origin`
#                        remote, and only asked for if that isn't on GitHub)
#   GITHUB_OIDC_SUBJECT_PREFIX
#                        the repo's OIDC subject before ':environment:'
#                        (otherwise read from GitHub via gh, falling back to
#                        repo:<owner>/<repo>)
#   AWS_PROFILE          AWS CLI profile (otherwise the stage's configured
#                        profile, then the default credential chain)
#   AWS_REGION           used when the stage config sets no region
#   <STAGE>_ROOT_DOMAIN  root domain every component is served from a
#                        subdomain of, e.g. DISCAVA_DEVELOPMENT_ROOT_DOMAIN=
#                        example.com (otherwise the root the GitHub
#                        environment's student portal domain already uses)
#   DEPLOY_ROLE_NAME, EXECUTION_ROLE_NAME, DOCKER_LOGIN_ROLE_NAME
#
# This script is designed to be idempotent and safe to run multiple times.

readonly INFRA_PROJECT_PATH="packages/infra"
# CloudFront-scoped WAF web ACLs are deployed as separate stacks in us-east-1.
readonly GLOBAL_REGION="us-east-1"
readonly OIDC_PROVIDER_URL="https://token.actions.githubusercontent.com"
readonly OIDC_PROVIDER_HOST="token.actions.githubusercontent.com"
# The CDK app synthesizes against the default bootstrap qualifier, so bootstrap
# and grant access to the same one.
readonly DEFAULT_CDK_QUALIFIER="hnb659fds"
if [[ -n "${CDK_QUALIFIER:-}" && "$CDK_QUALIFIER" != "$DEFAULT_CDK_QUALIFIER" ]]; then
  echo "Custom CDK bootstrap qualifiers aren't supported: the CDK app deploys with the default ($DEFAULT_CDK_QUALIFIER). Unset CDK_QUALIFIER and re-run." >&2
  exit 1
fi
readonly CDK_QUALIFIER="$DEFAULT_CDK_QUALIFIER"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT

ASSUME_YES=false
REQUESTED_STAGE=""

print_usage() {
  sed -n '/^# Usage:/,/^# This script/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) ASSUME_YES=true ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      print_usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$REQUESTED_STAGE" ]]; then
        print_usage >&2
        exit 1
      fi
      REQUESTED_STAGE="$1"
      ;;
  esac
  shift
done

if [[ "$ASSUME_YES" == false && ! -t 0 ]]; then
  echo "stdin isn't a terminal, so answers can't be prompted for; pass --yes to accept the defaults." >&2
  exit 1
fi

# ask <var> <question> [default]: prompts until a non-empty answer, falling
# back to the default on Enter (or without prompting under --yes).
ask() {
  local var="$1" question="$2" default="${3:-}" answer=""
  while [[ -z "$answer" ]]; do
    if [[ "$ASSUME_YES" == true ]]; then
      answer="$default"
      [[ -n "$answer" ]] || { echo "No default for: $question" >&2; exit 1; }
    else
      read -r -p "$question${default:+ [$default]}: " answer
      answer="${answer:-$default}"
    fi
  done
  printf -v "$var" '%s' "$answer"
}

# ask_optional <var> <question> [default]: like ask, but an empty answer is
# allowed; typing `-` clears a non-empty default.
ask_optional() {
  local var="$1" question="$2" default="${3:-}" answer=""
  if [[ "$ASSUME_YES" == true ]]; then
    answer="$default"
  else
    read -r -p "$question${default:+ [$default, - for none]}: " answer
    answer="${answer:-$default}"
    [[ "$answer" != "-" ]] || answer=""
  fi
  printf -v "$var" '%s' "$answer"
}

# ask_yes_no <question> <y|n>: succeeds on yes.
ask_yes_no() {
  local question="$1" default="$2" answer=""
  if [[ "$ASSUME_YES" == true ]]; then
    answer="$default"
  else
    local hint="[y/N]"
    [[ "$default" == y ]] && hint="[Y/n]"
    read -r -p "$question $hint " answer
    answer="${answer:-$default}"
  fi
  [[ "$answer" =~ ^[yY]([eE][sS])?$ ]]
}

section() {
  echo ""
  echo "== $1"
}

# paragraph <text>: prints text word-wrapped to the terminal's width, at most
# 80 columns, so narrow terminals don't re-wrap pre-broken lines mid-sentence.
paragraph() {
  local width
  width="$(tput cols 2>/dev/null || echo 80)"
  [[ "$width" =~ ^[0-9]+$ && "$width" -le 80 ]] || width=80
  fold -s -w "$width" <<<"$1" | sed 's/ *$//'
}

# Prints `<stage>` lines, or `<field>=<value>` lines for one stage's config.
read_stages_config() {
  (
    cd "$REPO_ROOT"
    pnpm --silent exec tsx --eval "
      import('./packages/common/infra-config/src/index.ts').then((m) => {
        const [project, stage] = process.argv.slice(1);
        if (!stage) return console.log(m.listStageNames(project).join('\n'));
        const config = m.resolveStage(project, stage) ?? {};
        const c = config.infra ?? {};
        // Component security settings default to on unless a stage relaxes them.
        const cloudFrontWaf = [c.studentPortal, c.instructorPortal, c.adminPortal, c.lessonMedia, c.publicMedia]
          .some((component) => component?.enableWaf !== false);
        console.log('region=' + (config.region ?? ''));
        console.log('account=' + (config.account ?? ''));
        console.log('profile=' + (config.credentials?.type === 'profile' ? config.credentials.profile : ''));
        console.log('cloudFrontWaf=' + cloudFrontWaf);
      });
    " "$@"
  )
}

# owner/repo of the `origin` remote, if it's on GitHub: an HTTPS or SSH URL,
# including an SSH host alias such as git@github.com-work:owner/repo.git.
detect_github_repository() {
  local remote_url
  remote_url="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || true)"
  if [[ "$remote_url" =~ [@/.]github\.com(-[A-Za-z0-9_.-]+)?[:/]([^/]+)/([^/]+)$ ]]; then
    echo "${BASH_REMATCH[2]}/${BASH_REMATCH[3]%.git}"
  fi
}

bootstrap_missing() {
  ! aws ssm get-parameter \
    --name "/cdk-bootstrap/$CDK_QUALIFIER/version" \
    --region "$1" >/dev/null 2>&1
}

github_cli_ready() {
  command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1
}

# SCREAMING_SNAKE_CASE segment used in stage config override variable names,
# e.g. discava-development -> DISCAVA_DEVELOPMENT. Must match toEnvSegment() in
# packages/common/infra-config/src/env-overrides.ts.
to_env_segment() {
  printf '%s' "$1" | sed -E 's/[^a-zA-Z0-9]+/_/g; s/([a-z0-9])([A-Z])/\1_\2/g' | tr '[:lower:]' '[:upper:]'
}

# Prints a variable's value on the stage's GitHub environment, or nothing if
# it (or the environment) doesn't exist yet. gh prints the error body to
# stdout on a 404, so only keep the output when the call succeeds.
github_environment_variable() {
  local value
  if value="$(gh api "repos/$GITHUB_REPOSITORY/environments/$TARGET_STAGE/variables/$1" --jq .value 2>/dev/null)"; then
    echo "$value"
  fi
}

# certificate_covers <comma-separated names> <domain>: whether a certificate
# with those subject alternative names is valid for the domain. A wildcard
# covers exactly one label.
certificate_covers() {
  local names domain
  names=",$(lower "$1"),"
  domain="$(lower "$2")"
  [[ "$names" == *",$domain,"* ]] && return 0
  [[ "${domain#*.}" == *.* && "$names" == *",*.${domain#*.},"* ]]
}

# root_domain_names <comma-separated labels> <root>: prints each label as a
# subdomain of root, with @ standing for root itself, e.g. @,www and
# example.com -> example.com,www.example.com.
root_domain_names() {
  local root="$2" label result=""
  local -a labels
  IFS=',' read -r -a labels <<<"$1"
  for label in ${labels[@]+"${labels[@]}"}; do
    if [[ "$label" == @ ]]; then
      label="$root"
    else
      label="$label.$root"
    fi
    result="${result:+$result,}$label"
  done
  echo "$result"
}

# certificate_covers_all <comma-separated names> <comma-separated domains>
certificate_covers_all() {
  local names="$1" domain
  local -a domains
  IFS=',' read -r -a domains <<<"$2"
  for domain in ${domains[@]+"${domains[@]}"}; do
    certificate_covers "$names" "$domain" || return 1
  done
}

# Why an API's certificate must be its own (#224): when one certificate covers
# both APIs' domains and they resolve to the same API Gateway address (the
# addresses are shared and rotate), browsers reuse a single HTTP/2 connection
# for both, and API Gateway rejects the requests sent down the other API's
# connection with a 403 and no CORS headers.
readonly API_CERTIFICATE_REASON="An API needs a certificate of its own, naming exactly its domain: when one certificate also covers the other API's domain, browsers can reuse a single connection for both APIs, and API Gateway rejects the requests that reach the wrong one (see #224)."

# api_certificate_error <comma-separated names> <domain> [other API's domain]:
# prints why a certificate with those subject alternative names can't serve
# an API custom domain, or nothing if it can. It must name the domain exactly,
# with no wildcard over it, and not cover the other API's domain.
api_certificate_error() {
  local names domain other="${3:-}"
  names=",$(lower "$1"),"
  domain="$(lower "$2")"
  if [[ "$names" != *",$domain,"* ]]; then
    echo "it covers $domain only through a wildcard"
  elif [[ "${domain#*.}" == *.* && "$names" == *",*.${domain#*.},"* ]]; then
    echo "it also covers *.${domain#*.}"
  elif [[ -n "$other" ]] && certificate_covers "$1" "$other"; then
    echo "it also covers $other"
  fi
}

# find_certificate <region> <comma-separated domains> <comma-separated key
# types> [api [other API's domain]]: prints the ARN of the first issued ACM
# certificate in the region with one of the key types and covering every
# domain; for an API, only one api_certificate_error accepts. The key types
# are passed explicitly because ACM otherwise only lists RSA_1024/RSA_2048
# certificates, silently skipping ECDSA and larger RSA ones.
find_certificate() {
  local region="$1" domains="$2" key_types="$3" kind="${4:-}" other="${5:-}"
  local arn names
  while IFS=$'\t' read -r arn names; do
    [[ -n "$arn" ]] || continue
    certificate_covers_all "$names" "$domains" || continue
    if [[ "$kind" == api && -n "$(api_certificate_error "$names" "$domains" "$other")" ]]; then
      continue
    fi
    echo "$arn"
    return
  done < <(aws acm list-certificates \
    --region "$region" \
    --certificate-statuses ISSUED \
    --includes "keyTypes=$key_types" \
    --query 'CertificateSummaryList[].[CertificateArn, join(`,`, SubjectAlternativeNameSummaries || [DomainName])]' \
    --output text 2>/dev/null || true)
}

# Prints True when the identity is verified for sending in the stage's region.
ses_identity_verified() {
  aws sesv2 get-email-identity \
    --region "$AWS_REGION" \
    --email-identity "$1" \
    --query VerifiedForSendingStatus \
    --output text 2>/dev/null || true
}

# GitHub sets a job's OIDC token subject to `<prefix>:environment:<name>` when
# it runs in an environment. The prefix is `repo:<owner>/<repo>` by default,
# but repositories using immutable subject claims embed the owner and repo IDs
# (`repo:<owner>@<id>/<repo>@<id>`), so ask GitHub rather than assume.
resolve_oidc_subject_prefix() {
  if [[ -n "${GITHUB_OIDC_SUBJECT_PREFIX:-}" ]]; then
    echo "$GITHUB_OIDC_SUBJECT_PREFIX"
    return
  fi

  if ! github_cli_ready; then
    paragraph "Couldn't read $GITHUB_REPOSITORY's OIDC subject settings (needs an authenticated gh CLI); assuming the default prefix repo:$GITHUB_REPOSITORY. If the repository uses immutable subject claims, set GITHUB_OIDC_SUBJECT_PREFIX instead." >&2
    echo "repo:$GITHUB_REPOSITORY"
    return
  fi

  # One request for both fields. errexit doesn't apply inside the command
  # substitution this runs in, so failures are handled explicitly: guessing
  # the prefix here would write a trust policy the repository can't satisfy.
  local settings use_default prefix
  if ! settings="$(gh api "repos/$GITHUB_REPOSITORY/actions/oidc/customization/sub" \
    --jq '"\(.use_default)\t\(.sub_claim_prefix // "")"')"; then
    paragraph "Couldn't read $GITHUB_REPOSITORY's OIDC subject settings from GitHub. Re-run, or set GITHUB_OIDC_SUBJECT_PREFIX to the part of the subject before ':environment:'." >&2
    return 1
  fi
  IFS=$'\t' read -r use_default prefix <<<"$settings"

  case "$use_default" in
    true) echo "${prefix:-repo:$GITHUB_REPOSITORY}" ;;
    false)
      paragraph "$GITHUB_REPOSITORY uses a custom OIDC subject claim template, so its tokens' subject can't be predicted here. Set GITHUB_OIDC_SUBJECT_PREFIX to the part of the subject before ':environment:' and re-run." >&2
      return 1
      ;;
    *)
      echo "Unexpected OIDC subject settings from GitHub: $settings" >&2
      return 1
      ;;
  esac
}

echo "============================================"
echo "Stage Deployment Setup"
echo "============================================"

section "Stage"
CONFIGURED_STAGES=()
while IFS= read -r configured_stage; do
  CONFIGURED_STAGES+=("$configured_stage")
done < <(read_stages_config "$INFRA_PROJECT_PATH")
readonly CONFIGURED_STAGES
if [[ ${#CONFIGURED_STAGES[@]} -eq 0 ]]; then
  echo "No stages found in packages/common/infra-config/src/stages.config.ts." >&2
  exit 1
fi
for i in "${!CONFIGURED_STAGES[@]}"; do
  echo "  $((i + 1))) ${CONFIGURED_STAGES[$i]}"
done

TARGET_STAGE=""
while [[ -z "$TARGET_STAGE" ]]; do
  ask stage_answer "Stage to set up (name or number)" "${REQUESTED_STAGE:-${CONFIGURED_STAGES[0]}}"
  for i in "${!CONFIGURED_STAGES[@]}"; do
    if [[ "$stage_answer" == "${CONFIGURED_STAGES[$i]}" || "$stage_answer" == "$((i + 1))" ]]; then
      TARGET_STAGE="${CONFIGURED_STAGES[$i]}"
    fi
  done
  if [[ -z "$TARGET_STAGE" ]]; then
    echo "Unknown stage: $stage_answer (add new stages to stages.config.ts first)" >&2
    [[ "$ASSUME_YES" == false ]] || exit 1
  fi
done
readonly TARGET_STAGE

STAGE_REGION=""
STAGE_ACCOUNT=""
STAGE_PROFILE=""
STAGE_CLOUDFRONT_WAF=""
while IFS='=' read -r key value; do
  case "$key" in
    region) STAGE_REGION="$value" ;;
    account) STAGE_ACCOUNT="$value" ;;
    profile) STAGE_PROFILE="$value" ;;
    cloudFrontWaf) STAGE_CLOUDFRONT_WAF="$value" ;;
  esac
done < <(read_stages_config "$INFRA_PROJECT_PATH" "$TARGET_STAGE")

section "GitHub"
# The repository whose deploy workflow the deploy role trusts. Taken from the
# `origin` remote without asking (it's in the summary before anything is
# created); asked for only when that isn't a GitHub repository. Set
# GITHUB_REPOSITORY to deploy from somewhere else, e.g. a fork.
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-$(detect_github_repository)}"
while [[ ! "$GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; do
  if [[ -n "$GITHUB_REPOSITORY" ]]; then
    echo "Expected owner/repo, got: $GITHUB_REPOSITORY" >&2
  elif [[ "$ASSUME_YES" == true ]]; then
    echo "The origin remote isn't a GitHub repository; set GITHUB_REPOSITORY=owner/repo." >&2
  fi
  [[ "$ASSUME_YES" == false ]] || exit 1
  ask GITHUB_REPOSITORY "Repository that runs the deploy workflow (owner/repo)"
done
readonly GITHUB_REPOSITORY
echo "Deploying from $GITHUB_REPOSITORY (set GITHUB_REPOSITORY=owner/repo to use another)."
if ! OIDC_SUBJECT_PREFIX="$(resolve_oidc_subject_prefix)"; then
  exit 1
fi
readonly OIDC_SUBJECT_PREFIX
echo "OIDC subject: $OIDC_SUBJECT_PREFIX:environment:$TARGET_STAGE"

section "AWS credentials"
available_profiles="$(aws configure list-profiles 2>/dev/null | paste -sd' ' - || true)"
[[ -z "$available_profiles" ]] || echo "Profiles in your AWS config: $available_profiles"
ask_optional selected_profile "AWS CLI profile for the target account (blank = default credential chain)" \
  "${AWS_PROFILE:-$STAGE_PROFILE}"
if [[ -n "$selected_profile" ]]; then
  export AWS_PROFILE="$selected_profile"
else
  unset AWS_PROFILE
fi

if ! CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text 2>&1)"; then
  echo "$CALLER_ARN" >&2
  paragraph "Couldn't authenticate with AWS. Log in first (e.g. \`aws sso login${selected_profile:+ --profile $selected_profile}\` or \`aws configure\`), then re-run." >&2
  exit 1
fi
readonly CALLER_ARN
# arn:<partition>:<service>::<account>:<resource>
AWS_PARTITION="$(cut -d: -f2 <<<"$CALLER_ARN")"
ACCOUNT_ID="$(cut -d: -f5 <<<"$CALLER_ARN")"
readonly AWS_PARTITION ACCOUNT_ID
echo "Authenticated as $CALLER_ARN (account $ACCOUNT_ID)"

if [[ -n "$STAGE_ACCOUNT" && "$STAGE_ACCOUNT" != "$ACCOUNT_ID" ]]; then
  echo "$TARGET_STAGE is configured for account $STAGE_ACCOUNT in stages.config.ts; switch credentials and re-run." >&2
  exit 1
fi

section "Region"
if [[ -n "$STAGE_REGION" ]]; then
  # CDK deploys the stage wherever stages.config.ts says, so don't offer a
  # different answer here.
  AWS_REGION="$STAGE_REGION"
  echo "Using $AWS_REGION (set for $TARGET_STAGE in stages.config.ts)"
else
  ask AWS_REGION "Primary AWS region for $TARGET_STAGE" \
    "${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
fi
readonly AWS_REGION

# CloudFormation-generated physical names (roles, functions, buckets, tables,
# rules) are prefixed with the stack name, and every stack in a stage is named
# `<stage>-*`, so this prefix scopes most permissions to one stage.
readonly RESOURCE_PREFIX="$TARGET_STAGE-"
# Generated bucket names are the lowercased equivalent.
BUCKET_PREFIX="$(lower "$RESOURCE_PREFIX")"
readonly BUCKET_PREFIX
# CDK-generated names for some resources (MediaConvert job templates, Scheduler
# groups) drop the hyphens from the stack path.
readonly COMPACT_PREFIX="${TARGET_STAGE//-/}"
# Role names deliberately don't start with RESOURCE_PREFIX, so the execution
# role's IAM permissions (scoped to `role/<stage>-*`) can't modify either role.
readonly DEPLOY_ROLE_NAME="${DEPLOY_ROLE_NAME:-github-deploy-$TARGET_STAGE}"
readonly EXECUTION_ROLE_NAME="${EXECUTION_ROLE_NAME:-cfn-execution-$TARGET_STAGE}"
# One per repository rather than per stage: CI jobs outside any stage's
# environment (e.g. ci.yml's Trivy scan) pull images too.
readonly DOCKER_LOGIN_ROLE_NAME="${DOCKER_LOGIN_ROLE_NAME:-github-docker-login-${GITHUB_REPOSITORY#*/}}"
# Every role the stage's stacks create must carry this boundary (the deploy
# workflow synthesizes with it applied), which caps what the execution role can
# grant through them. Must match stagePermissionsBoundaryName() in
# packages/common/constructs/src/core/stage-isolation.ts.
readonly BOUNDARY_POLICY_NAME="permissions-boundary-$TARGET_STAGE"
# Managed policies holding the rest of the execution role's permissions (see
# attach_execution_policy). Like the boundary, named apart from
# RESOURCE_PREFIX, and the execution role can't modify managed policies.
readonly EXECUTION_DATA_POLICY_NAME="$EXECUTION_ROLE_NAME-data"
readonly EXECUTION_EDGE_POLICY_NAME="$EXECUTION_ROLE_NAME-edge"
readonly EXECUTION_COMPUTE_POLICY_NAME="$EXECUTION_ROLE_NAME-compute"
readonly BOUNDARY_POLICY_ARN="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:policy/$BOUNDARY_POLICY_NAME"
# Each stage publishes its assets under its own prefix in the shared bootstrap
# buckets (see StageIsolationSynthesizer), so access is scoped to that prefix.
readonly ASSETS_BUCKET_PRIMARY="cdk-$CDK_QUALIFIER-assets-$ACCOUNT_ID-$AWS_REGION"
readonly ASSETS_BUCKET_GLOBAL="cdk-$CDK_QUALIFIER-assets-$ACCOUNT_ID-$GLOBAL_REGION"
readonly ASSETS_PREFIX="$TARGET_STAGE/"

section "CDK bootstrap"
REQUIRED_REGIONS=("$AWS_REGION")
if [[ "$STAGE_CLOUDFRONT_WAF" == true && "$AWS_REGION" != "$GLOBAL_REGION" ]]; then
  REQUIRED_REGIONS+=("$GLOBAL_REGION")
fi
BOOTSTRAP_REGIONS=()
for region in "${REQUIRED_REGIONS[@]}"; do
  if ! bootstrap_missing "$region"; then
    echo "Already bootstrapped: $region"
  elif ask_yes_no "CDK isn't bootstrapped in $region (qualifier $CDK_QUALIFIER). Bootstrap it?" y; then
    BOOTSTRAP_REGIONS+=("$region")
  else
    echo "Skipping; deploys to $region will fail until it's bootstrapped." >&2
  fi
done

section "GitHub environment"
CONFIGURE_GITHUB=false
SET_AUTO_DEPLOY=false
if ! github_cli_ready; then
  echo "The gh CLI isn't installed or logged in, so the GitHub environment will be listed for you to set up by hand."
elif ask_yes_no "Create the '$TARGET_STAGE' environment in $GITHUB_REPOSITORY and set its variables with gh?" y; then
  CONFIGURE_GITHUB=true
  # gh prints the error body to stdout on a 404 (variable not set yet), so
  # only keep the output when the call succeeds.
  current_auto_deploy=""
  if auto_deploy_value="$(gh api "repos/$GITHUB_REPOSITORY/actions/variables/AUTO_DEPLOY_STAGE" --jq .value 2>/dev/null)"; then
    current_auto_deploy="$auto_deploy_value"
  fi
  if [[ "$current_auto_deploy" == "$TARGET_STAGE" ]]; then
    echo "$TARGET_STAGE already deploys automatically when CI passes on main."
  elif ask_yes_no "Deploy $TARGET_STAGE automatically whenever CI passes on main?${current_auto_deploy:+ (replaces $current_auto_deploy)}" n; then
    SET_AUTO_DEPLOY=true
  fi
fi

section "Custom domains"
STAGE_ENV_PREFIX="$(to_env_segment "$TARGET_STAGE")_"
readonly STAGE_ENV_PREFIX
# Component settings are under `infra` in the stage config, so their variables are
# <STAGE>_INFRA_<COMPONENT>_<FIELD>.
STAGE_INFRA_ENV_PREFIX="${STAGE_ENV_PREFIX}INFRA_"
readonly STAGE_INFRA_ENV_PREFIX
READ_GITHUB_VARIABLES=false
if github_cli_ready; then
  READ_GITHUB_VARIABLES=true
fi
# NAME=value pairs to set, and names to remove, on the GitHub environment.
DOMAIN_VARIABLES=()
DOMAIN_VARIABLES_TO_DELETE=()
# component|env segment|label|kind|subdomain labels under the root domain
# (@ is the root itself)
readonly DOMAIN_SPECS=(
  "coreApi|CORE_API|Core API|api|core-api"
  "instructorApi|INSTRUCTOR_API|Instructor API|api|instructor-api"
  "studentPortal|STUDENT_PORTAL|Student portal|cloudfront|@,www"
  "instructorPortal|INSTRUCTOR_PORTAL|Instructor portal|cloudfront|instructor"
  "adminPortal|ADMIN_PORTAL|Admin portal|cloudfront|admin"
  "lessonMedia|LESSON_MEDIA|Lesson media|cloudfront|lesson-media"
  "publicMedia|PUBLIC_MEDIA|Public media|cloudfront|media"
)
readonly COOKIE_DOMAIN_VARIABLE="${STAGE_INFRA_ENV_PREFIX}LESSON_MEDIA_COOKIE_DOMAIN"
readonly NOTIFICATIONS_FROM_VARIABLE="${STAGE_INFRA_ENV_PREFIX}NOTIFICATIONS_FROM_ADDRESS"
readonly NOTIFICATIONS_IDENTITY_VARIABLE="${STAGE_INFRA_ENV_PREFIX}NOTIFICATIONS_SES_IDENTITY"
readonly NOTIFICATIONS_FROM_LOCAL_PART="notifications"
paragraph "Give a root domain and every component is served from a subdomain of it (core-api.<root>, instructor-api.<root>, <root> and www.<root> for the student portal, instructor.<root>, admin.<root>, lesson-media.<root>, media.<root>), each with the issued ACM certificate found for it: in $AWS_REGION for the APIs, in $GLOBAL_REGION for the CloudFront components. Notification emails are sent as $NOTIFICATIONS_FROM_LOCAL_PART@<root> when <root> is a verified SES identity in $AWS_REGION. Leave it blank for the generated *.execute-api.amazonaws.com / *.cloudfront.net hostnames and no notification email. DNS records and SES identities aren't created for you."
# The default is the root the student portal is already served from.
root_domain_variable="${STAGE_ENV_PREFIX}ROOT_DOMAIN"
root_domain_default="${!root_domain_variable:-}"
if [[ -z "$root_domain_default" && "$READ_GITHUB_VARIABLES" == true ]]; then
  root_domain_default="$(github_environment_variable "${STAGE_INFRA_ENV_PREFIX}STUDENT_PORTAL_DOMAIN_NAMES")"
  root_domain_default="${root_domain_default%%,*}"
fi
while true; do
  ask_optional ROOT_DOMAIN "Root domain" "$root_domain_default"
  ROOT_DOMAIN="${ROOT_DOMAIN// /}"
  ROOT_DOMAIN="$(lower "$ROOT_DOMAIN")"
  [[ -n "$ROOT_DOMAIN" && ! "$ROOT_DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || break
  echo "Not a valid domain name: $ROOT_DOMAIN" >&2
  [[ "$ASSUME_YES" == false ]] || exit 1
done
readonly ROOT_DOMAIN

if [[ -z "$ROOT_DOMAIN" ]]; then
  # No custom domains: remove any a previous run stored.
  if [[ "$READ_GITHUB_VARIABLES" == true ]]; then
    for spec in "${DOMAIN_SPECS[@]}"; do
      IFS='|' read -r _ segment _ kind _ <<<"$spec"
      if [[ "$kind" == api ]]; then
        domain_variable="$STAGE_INFRA_ENV_PREFIX${segment}_DOMAIN_NAME"
      else
        domain_variable="$STAGE_INFRA_ENV_PREFIX${segment}_DOMAIN_NAMES"
      fi
      for variable in "$domain_variable" "$STAGE_INFRA_ENV_PREFIX${segment}_CERTIFICATE_ARN"; do
        [[ -z "$(github_environment_variable "$variable")" ]] || DOMAIN_VARIABLES_TO_DELETE+=("$variable")
      done
    done
    [[ -z "$(github_environment_variable "$COOKIE_DOMAIN_VARIABLE")" ]] || DOMAIN_VARIABLES_TO_DELETE+=("$COOKIE_DOMAIN_VARIABLE")
  fi
else
  readonly CORE_API_DOMAIN="core-api.$ROOT_DOMAIN"
  readonly INSTRUCTOR_API_DOMAIN="instructor-api.$ROOT_DOMAIN"
  missing_certificates=false
  for spec in "${DOMAIN_SPECS[@]}"; do
    IFS='|' read -r component segment label kind root_labels <<<"$spec"
    domains="$(root_domain_names "$root_labels" "$ROOT_DOMAIN")"
    if [[ "$kind" == api ]]; then
      # API Gateway custom domains take a single name.
      domain_variable="$STAGE_INFRA_ENV_PREFIX${segment}_DOMAIN_NAME"
      # Regional custom domains accept RSA public keys of at most 2048 bits.
      certificate_region="$AWS_REGION"
      certificate_key_types="RSA_1024,RSA_2048,EC_prime256v1,EC_secp384r1"
      other_api_domain="$CORE_API_DOMAIN"
      [[ "$component" != coreApi ]] || other_api_domain="$INSTRUCTOR_API_DOMAIN"
      certificate="$(find_certificate "$certificate_region" "$domains" "$certificate_key_types" api "$other_api_domain")"
    else
      domain_variable="$STAGE_INFRA_ENV_PREFIX${segment}_DOMAIN_NAMES"
      certificate_region="$GLOBAL_REGION"
      certificate_key_types="RSA_1024,RSA_2048,RSA_3072,RSA_4096,EC_prime256v1,EC_secp384r1"
      certificate="$(find_certificate "$certificate_region" "$domains" "$certificate_key_types")"
    fi

    if [[ -z "$certificate" ]]; then
      missing_certificates=true
      if [[ "$kind" == api ]]; then
        paragraph "$label: no issued certificate in $certificate_region is for exactly $domains (and not also $other_api_domain). $API_CERTIFICATE_REASON" >&2
      else
        paragraph "$label: no issued certificate in $certificate_region covers $domains." >&2
      fi
      continue
    fi
    echo "$label: $domains ($certificate)"
    DOMAIN_VARIABLES+=("$domain_variable=$domains" "$STAGE_INFRA_ENV_PREFIX${segment}_CERTIFICATE_ARN=$certificate")
  done
  if [[ "$missing_certificates" == true ]]; then
    paragraph "Request the missing certificates in ACM (or leave the root domain blank), then re-run." >&2
    exit 1
  fi
  # HLS playback's signed cookies are issued by Instructor API and sent to
  # Lesson media, so they're set for the root both are subdomains of.
  DOMAIN_VARIABLES+=("$COOKIE_DOMAIN_VARIABLE=$ROOT_DOMAIN")
fi

# Notification emails are sent as notifications@<root>, through the root's SES
# domain identity. The script only manages that pair while it's unset or still
# its own: notifications@<identity> with <identity>, where <identity> is the
# root given now or the one a previous run stored (the student portal's first
# domain). Any other sender was set by hand, as the deploy docs allow, and is
# kept on every re-run. Without a sender, emails are recorded as skipped, so a
# missing identity is a warning, not a stop.
notifications_from=""
notifications_identity=""
previous_root_domain=""
if [[ "$READ_GITHUB_VARIABLES" == true ]]; then
  notifications_from="$(github_environment_variable "$NOTIFICATIONS_FROM_VARIABLE")"
  notifications_identity="$(github_environment_variable "$NOTIFICATIONS_IDENTITY_VARIABLE")"
  previous_root_domain="$(github_environment_variable "${STAGE_INFRA_ENV_PREFIX}STUDENT_PORTAL_DOMAIN_NAMES")"
  previous_root_domain="${previous_root_domain%%,*}"
fi
notifications_sender_is_own() {
  [[ -n "$notifications_identity" &&
    "$notifications_from" == "$NOTIFICATIONS_FROM_LOCAL_PART@$notifications_identity" &&
    ("$notifications_identity" == "$ROOT_DOMAIN" || "$notifications_identity" == "$previous_root_domain") ]]
}
if [[ -n "$notifications_from$notifications_identity" ]] && ! notifications_sender_is_own; then
  echo "Notification email: keeping the sender set by hand (${notifications_from:-no address}, SES identity ${notifications_identity:-none})"
elif [[ -n "$ROOT_DOMAIN" && "$(ses_identity_verified "$ROOT_DOMAIN")" == True ]]; then
  echo "Notification email: $NOTIFICATIONS_FROM_LOCAL_PART@$ROOT_DOMAIN (SES identity $ROOT_DOMAIN)"
  DOMAIN_VARIABLES+=(
    "$NOTIFICATIONS_FROM_VARIABLE=$NOTIFICATIONS_FROM_LOCAL_PART@$ROOT_DOMAIN"
    "$NOTIFICATIONS_IDENTITY_VARIABLE=$ROOT_DOMAIN"
  )
else
  if [[ -n "$ROOT_DOMAIN" ]]; then
    paragraph "Notification email: $ROOT_DOMAIN isn't a verified SES identity in $AWS_REGION, so notification emails will be recorded as skipped. To send them, create the domain identity in SES ($AWS_REGION), add the DKIM CNAME records it lists to $ROOT_DOMAIN's DNS, wait until SES shows it verified, and re-run. While the account is in the SES sandbox, each recipient address must be verified too." >&2
  fi
  [[ -z "$notifications_from" ]] || DOMAIN_VARIABLES_TO_DELETE+=("$NOTIFICATIONS_FROM_VARIABLE")
  [[ -z "$notifications_identity" ]] || DOMAIN_VARIABLES_TO_DELETE+=("$NOTIFICATIONS_IDENTITY_VARIABLE")
fi

# Policy documents are written to fixed names in one private directory:
# mktemp -t takes a template on GNU but a prefix on BSD/macOS, so it can't
# name the files consistently.
POLICY_DIR="$(mktemp -d)"
readonly POLICY_DIR
cleanup() {
  rm -rf "$POLICY_DIR"
}

trap cleanup EXIT

confirm() {
  echo ""
  echo "============================================"
  echo "GitHub repo:     $GITHUB_REPOSITORY"
  echo "AWS account:     $ACCOUNT_ID${AWS_PROFILE:+ (profile $AWS_PROFILE)}"
  echo "AWS region:      $AWS_REGION"
  echo "Stage:           $TARGET_STAGE"
  echo ""
  echo "This will create or update:"
  echo "  - OIDC provider: $OIDC_PROVIDER_HOST"
  echo "  - Deploy role:   $DEPLOY_ROLE_NAME"
  echo "  - Exec role:     $EXECUTION_ROLE_NAME (+ policies $EXECUTION_DATA_POLICY_NAME, $EXECUTION_EDGE_POLICY_NAME, $EXECUTION_COMPUTE_POLICY_NAME)"
  echo "  - Boundary:      $BOUNDARY_POLICY_NAME"
  echo "  - Docker login:  $DOCKER_LOGIN_ROLE_NAME (shared by every stage)"
  if [[ ${#BOOTSTRAP_REGIONS[@]} -gt 0 ]]; then
    echo "  - CDK bootstrap: ${BOOTSTRAP_REGIONS[*]}"
  fi
  if [[ "$CONFIGURE_GITHUB" == true ]]; then
    echo "  - GitHub env:    $TARGET_STAGE (AWS_REGION, AWS_DEPLOY_ROLE_ARN, AWS_EXECUTION_ROLE_ARN)"
  fi
  if [[ "$SET_AUTO_DEPLOY" == true ]]; then
    echo "  - GitHub var:    AUTO_DEPLOY_STAGE=$TARGET_STAGE"
  fi
  if [[ "$CONFIGURE_GITHUB" == true ]]; then
    echo "  - GitHub var:    AWS_DOCKER_LOGIN_ROLE_ARN (repository)"
    local variable
    for variable in ${DOMAIN_VARIABLES[@]+"${DOMAIN_VARIABLES[@]}"}; do
      echo "  - GitHub var:    $variable"
    done
    for variable in ${DOMAIN_VARIABLES_TO_DELETE[@]+"${DOMAIN_VARIABLES_TO_DELETE[@]}"}; do
      echo "  - Remove var:    $variable"
    done
  fi
  echo "============================================"
  if ! ask_yes_no "Continue?" y; then
    echo "Aborted."
    exit 0
  fi
}

ensure_oidc_provider() {
  local provider_arn="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:oidc-provider/$OIDC_PROVIDER_HOST"

  if aws iam get-open-id-connect-provider \
    --open-id-connect-provider-arn "$provider_arn" >/dev/null 2>&1; then
    echo "OIDC provider already exists: $provider_arn"
    return
  fi

  echo "Creating OIDC provider: $provider_arn"
  aws iam create-open-id-connect-provider \
    --url "$OIDC_PROVIDER_URL" \
    --client-id-list sts.amazonaws.com >/dev/null
}

create_policy_files() {
  DEPLOY_TRUST_POLICY_FILE="$POLICY_DIR/${DEPLOY_ROLE_NAME}.trust.json"
  DEPLOY_POLICY_FILE="$POLICY_DIR/${DEPLOY_ROLE_NAME}.policy.json"
  EXECUTION_TRUST_POLICY_FILE="$POLICY_DIR/${EXECUTION_ROLE_NAME}.trust.json"

  cat >"$DEPLOY_TRUST_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:oidc-provider/$OIDC_PROVIDER_HOST"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$OIDC_PROVIDER_HOST:aud": "sts.amazonaws.com",
          "$OIDC_PROVIDER_HOST:sub": "$OIDC_SUBJECT_PREFIX:environment:$TARGET_STAGE"
        }
      }
    }
  ]
}
EOF

  cat >"$EXECUTION_TRUST_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudformation.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

  cat >"$DEPLOY_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationDeployDiscava",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack",
        "cloudformation:UpdateStack",
        "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate",
        "cloudformation:GetTemplateSummary",
        "cloudformation:ValidateTemplate",
        "cloudformation:CreateChangeSet",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:DeleteChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:ListChangeSets"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:cloudformation:$AWS_REGION:$ACCOUNT_ID:stack/$RESOURCE_PREFIX*/*",
        "arn:$AWS_PARTITION:cloudformation:$GLOBAL_REGION:$ACCOUNT_ID:stack/$RESOURCE_PREFIX*/*"
      ]
    },
    {
      "Sid": "ReadCdkBootstrapVersion",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": [
        "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/cdk-bootstrap/$CDK_QUALIFIER/version",
        "arn:$AWS_PARTITION:ssm:$GLOBAL_REGION:$ACCOUNT_ID:parameter/cdk-bootstrap/$CDK_QUALIFIER/version"
      ]
    },
    {
      "Sid": "LocateBootstrapAssetsBuckets",
      "Effect": "Allow",
      "Action": "s3:GetBucketLocation",
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY",
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_GLOBAL"
      ]
    },
    {
      "Sid": "ListStageBootstrapAssets",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY",
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_GLOBAL"
      ],
      "Condition": {
        "StringLike": {
          "s3:prefix": "$ASSETS_PREFIX*"
        }
      }
    },
    {
      "Sid": "PublishStageBootstrapAssets",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY/$ASSETS_PREFIX*",
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_GLOBAL/$ASSETS_PREFIX*"
      ]
    },
    {
      "Sid": "PassCloudFormationServiceRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$EXECUTION_ROLE_NAME"
    }
  ]
}
EOF
}

# upsert_role <name> <trust policy file> <description> [stage tag]: the stage
# tag defaults to the target stage; pass an empty one for a role every stage
# shares.
upsert_role() {
  local role_name="$1"
  local trust_policy_file="$2"
  local description="$3"
  local stage="${4-$TARGET_STAGE}"
  local -a tags=(Key=Project,Value=discava Key=ManagedBy,Value=setup-stage.sh)
  [[ -z "$stage" ]] || tags+=(Key=Stage,Value="$stage")

  if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
    echo "Updating trust policy for role: $role_name"
    aws iam update-assume-role-policy \
      --role-name "$role_name" \
      --policy-document "file://$trust_policy_file"
  else
    echo "Creating role: $role_name"
    aws iam create-role \
      --role-name "$role_name" \
      --assume-role-policy-document "file://$trust_policy_file" \
      --description "$description" \
      --tags "${tags[@]}" >/dev/null
  fi
}

attach_inline_policy() {
  echo "Attaching deploy permissions to: $DEPLOY_ROLE_NAME"
  aws iam put-role-policy \
    --role-name "$DEPLOY_ROLE_NAME" \
    --policy-name DiscavaGitHubDeployPermissions \
    --policy-document "file://$DEPLOY_POLICY_FILE"
}

create_docker_login_policy_files() {
  DOCKER_LOGIN_TRUST_POLICY_FILE="$POLICY_DIR/${DOCKER_LOGIN_ROLE_NAME}.trust.json"
  DOCKER_LOGIN_POLICY_FILE="$POLICY_DIR/${DOCKER_LOGIN_ROLE_NAME}.policy.json"

  # Any workflow in the repository may assume it: all it grants is a pull
  # token for public images.
  cat >"$DOCKER_LOGIN_TRUST_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:oidc-provider/$OIDC_PROVIDER_HOST"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "$OIDC_PROVIDER_HOST:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "$OIDC_PROVIDER_HOST:sub": "$OIDC_SUBJECT_PREFIX:*"
        }
      }
    }
  ]
}
EOF

  # Neither action supports resource-level permissions. GetAuthorizationToken
  # gets its bearer token through sts:GetServiceBearerToken, granted without
  # conditions as in AWS's AmazonElasticContainerRegistryPublicReadOnly: an
  # sts:AWSServiceName condition doesn't match the request ECR Public makes.
  cat >"$DOCKER_LOGIN_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EcrPublicAuthorizationToken",
      "Effect": "Allow",
      "Action": "ecr-public:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPublicBearerToken",
      "Effect": "Allow",
      "Action": "sts:GetServiceBearerToken",
      "Resource": "*"
    }
  ]
}
EOF
}

attach_docker_login_policy() {
  echo "Attaching Docker login permissions to: $DOCKER_LOGIN_ROLE_NAME"
  aws iam put-role-policy \
    --role-name "$DOCKER_LOGIN_ROLE_NAME" \
    --policy-name DiscavaDockerLoginPermissions \
    --policy-document "file://$DOCKER_LOGIN_POLICY_FILE"
}

# upsert_managed_policy <name> <document file> <description>: creates the
# customer managed policy, or makes the document its new default version.
upsert_managed_policy() {
  local name="$1" file="$2" description="$3"
  local arn="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:policy/$name"
  if aws iam get-policy --policy-arn "$arn" >/dev/null 2>&1; then
    # A managed policy keeps at most five versions; make room for the new one.
    local non_default_versions
    non_default_versions="$(aws iam list-policy-versions \
      --policy-arn "$arn" \
      --query 'sort_by(Versions[?!IsDefaultVersion], &CreateDate)[].VersionId' \
      --output text)"
    if [[ $(wc -w <<<"$non_default_versions") -ge 4 ]]; then
      aws iam delete-policy-version \
        --policy-arn "$arn" \
        --version-id "${non_default_versions%%[[:space:]]*}"
    fi
    echo "Updating managed policy: $name"
    aws iam create-policy-version \
      --policy-arn "$arn" \
      --policy-document "file://$file" \
      --set-as-default >/dev/null
  else
    echo "Creating managed policy: $name"
    aws iam create-policy \
      --policy-name "$name" \
      --policy-document "file://$file" \
      --description "$description" \
      --tags \
        Key=Project,Value=discava \
        Key=ManagedBy,Value=setup-stage.sh \
        Key=Stage,Value="$TARGET_STAGE" >/dev/null
  fi
}

# The execution role's permissions: what CloudFormation may do while it
# deploys the stage. IAM caps a role's inline policies at 10,240 characters in
# all and each managed policy at 6,144 (whitespace excluded), more than one
# policy holds, so they're split by what they cover:
# - inline: the IAM guardrails (roles it creates must carry the stage's
#   boundary; only stage roles are passed to services) and reading CDK's
#   bootstrap version and assets, kept on the role itself so they're reviewed
#   together
# - <role>-data: S3, DynamoDB, KMS, OpenSearch Serverless and CloudWatch Logs
# - <role>-edge: CloudFront, WAF, API Gateway and Cognito
# - <role>-compute: Lambda and its event sources, SQS, EventBridge, Scheduler,
#   MediaConvert and the stage's settings parameters
# A new permission goes in the group it belongs to; the tests check each
# policy still fits.
create_execution_policy_files() {
  EXECUTION_POLICY_FILE="$POLICY_DIR/${EXECUTION_ROLE_NAME}.policy.json"
  EXECUTION_DATA_POLICY_FILE="$POLICY_DIR/${EXECUTION_DATA_POLICY_NAME}.json"
  EXECUTION_EDGE_POLICY_FILE="$POLICY_DIR/${EXECUTION_EDGE_POLICY_NAME}.json"
  EXECUTION_COMPUTE_POLICY_FILE="$POLICY_DIR/${EXECUTION_COMPUTE_POLICY_NAME}.json"

  cat >"$EXECUTION_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSsmParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/cdk-bootstrap/$CDK_QUALIFIER/version",
        "arn:$AWS_PARTITION:ssm:$GLOBAL_REGION:$ACCOUNT_ID:parameter/cdk-bootstrap/$CDK_QUALIFIER/version",
        "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/cdk/exports/$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:ssm:$GLOBAL_REGION:$ACCOUNT_ID:parameter/cdk/exports/$RESOURCE_PREFIX*"
      ]
    },
    {
      "Sid": "ReadCdkAssets",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:GetObjectVersion"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY/$ASSETS_PREFIX*",
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_GLOBAL/$ASSETS_PREFIX*"
      ]
    },
    {
      "Sid": "ManageDiscavaRoles",
      "Effect": "Allow",
      "Action": [
        "iam:DeleteRole",
        "iam:GetRole",
        "iam:TagRole",
        "iam:UntagRole",
        "iam:UpdateRole",
        "iam:UpdateAssumeRolePolicy",
        "iam:GetRolePolicy",
        "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies"
      ],
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$RESOURCE_PREFIX*"
    },
    {
      "Sid": "ManageDiscavaManagedPolicies",
      "Effect": "Allow",
      "Action": [
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:GetPolicy",
        "iam:GetPolicyVersion",
        "iam:ListPolicyVersions",
        "iam:CreatePolicyVersion",
        "iam:DeletePolicyVersion",
        "iam:TagPolicy",
        "iam:UntagPolicy"
      ],
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:policy/$RESOURCE_PREFIX*"
    },
    {
      "Sid": "GrantOnlyWithinStageBoundary",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole",
        "iam:PutRolePolicy",
        "iam:DeleteRolePolicy",
        "iam:AttachRolePolicy",
        "iam:DetachRolePolicy",
        "iam:PutRolePermissionsBoundary"
      ],
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$RESOURCE_PREFIX*",
      "Condition": {
        "StringEquals": {
          "iam:PermissionsBoundary": "$BOUNDARY_POLICY_ARN"
        }
      }
    },
    {
      "Sid": "PassOnlyDiscavaRolesToServices",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$RESOURCE_PREFIX*"
      ]
    }
  ]
}
EOF

  cat >"$EXECUTION_DATA_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3BucketsForDiscava",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:DeleteBucket",
        "s3:GetBucket*",
        "s3:GetEncryptionConfiguration",
        "s3:GetLifecycleConfiguration",
        "s3:ListBucket",
        "s3:PutEncryptionConfiguration",
        "s3:PutBucketNotification",
        "s3:PutBucketOwnershipControls",
        "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock",
        "s3:PutBucketTagging",
        "s3:PutBucketVersioning",
        "s3:PutLifecycleConfiguration",
        "s3:PutBucketCORS",
        "s3:PutBucketLogging",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketAcl",
        "s3:AllowVendedLogDeliveryForResource"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$BUCKET_PREFIX*"
      ]
    },
    {
      "Sid": "S3ObjectsForDiscava",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObjectTagging",
        "s3:PutObjectTagging",
        "s3:DeleteObjectTagging"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$BUCKET_PREFIX*/*"
      ]
    },
    {
      "Sid": "DynamoDbForDiscava",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable",
        "dynamodb:DeleteTable",
        "dynamodb:DescribeTable",
        "dynamodb:UpdateTable",
        "dynamodb:UpdateTimeToLive",
        "dynamodb:DescribeTimeToLive",
        "dynamodb:TagResource",
        "dynamodb:UntagResource",
        "dynamodb:ListTagsOfResource",
        "dynamodb:UpdateContinuousBackups",
        "dynamodb:DescribeContinuousBackups",
        "dynamodb:DescribeContributorInsights",
        "dynamodb:DescribeKinesisStreamingDestination",
        "dynamodb:GetResourcePolicy",
        "dynamodb:PutResourcePolicy",
        "dynamodb:DeleteResourcePolicy"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:dynamodb:$AWS_REGION:$ACCOUNT_ID:table/$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:dynamodb:$AWS_REGION:$ACCOUNT_ID:table/$RESOURCE_PREFIX*/index/*"
      ]
    },
    {
      "Sid": "KmsKeysForDiscava",
      "Effect": "Allow",
      "Action": [
        "kms:CreateKey",
        "kms:DescribeKey",
        "kms:GetKeyPolicy",
        "kms:PutKeyPolicy",
        "kms:GetKeyRotationStatus",
        "kms:EnableKeyRotation",
        "kms:DisableKeyRotation",
        "kms:ListResourceTags",
        "kms:TagResource",
        "kms:UntagResource",
        "kms:ScheduleKeyDeletion",
        "kms:CreateGrant",
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:GenerateDataKey*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "OpenSearchServerlessCollectionsForDiscava",
      "Effect": "Allow",
      "Action": [
        "aoss:CreateCollection",
        "aoss:UpdateCollection",
        "aoss:DeleteCollection",
        "aoss:CreateCollectionGroup",
        "aoss:UpdateCollectionGroup",
        "aoss:DeleteCollectionGroup",
        "aoss:AddCollectionToCollectionGroup",
        "aoss:TagResource",
        "aoss:UntagResource"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:aoss:$AWS_REGION:$ACCOUNT_ID:collection/*",
        "arn:$AWS_PARTITION:aoss:$AWS_REGION:$ACCOUNT_ID:collection-group/*"
      ]
    },
    {
      "Sid": "OpenSearchServerlessPoliciesAndReads",
      "Effect": "Allow",
      "Action": [
        "aoss:BatchGetCollection",
        "aoss:BatchGetCollectionGroup",
        "aoss:ListCollections",
        "aoss:ListCollectionGroups",
        "aoss:ListTagsForResource",
        "aoss:ListSecurityPolicies",
        "aoss:ListAccessPolicies",
        "aoss:CreateSecurityPolicy",
        "aoss:GetSecurityPolicy",
        "aoss:UpdateSecurityPolicy",
        "aoss:DeleteSecurityPolicy",
        "aoss:CreateAccessPolicy",
        "aoss:GetAccessPolicy",
        "aoss:UpdateAccessPolicy",
        "aoss:DeleteAccessPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "OpenSearchServerlessServiceLinkedRole",
      "Effect": "Allow",
      "Action": "iam:CreateServiceLinkedRole",
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/aws-service-role/observability.aoss.amazonaws.com/AWSServiceRoleForAmazonOpenSearchServerless",
      "Condition": {
        "StringEquals": {
          "iam:AWSServiceName": "observability.aoss.amazonaws.com"
        }
      }
    },
    {
      "Sid": "SecretsForDiscava",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:TagResource",
        "secretsmanager:UntagResource"
      ],
      "Resource": "arn:$AWS_PARTITION:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:$COMPACT_PREFIX*"
    },
    {
      "Sid": "GenerateSecretValues",
      "Effect": "Allow",
      "Action": "secretsmanager:GetRandomPassword",
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogsForDiscava",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:DeleteLogGroup",
        "logs:PutRetentionPolicy",
        "logs:DeleteRetentionPolicy",
        "logs:AssociateKmsKey",
        "logs:DisassociateKmsKey",
        "logs:DescribeLogGroups",
        "logs:ListTagsForResource",
        "logs:TagResource",
        "logs:UntagResource",
        "logs:*Deliver*",
        "logs:*ResourcePolic*"
      ],
      "Resource": "*"
    }
  ]
}
EOF

  cat >"$EXECUTION_EDGE_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFrontForDiscava",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution",
        "cloudfront:CreateDistributionWithTags",
        "cloudfront:UpdateDistribution",
        "cloudfront:DeleteDistribution",
        "cloudfront:GetDistribution",
        "cloudfront:GetDistributionConfig",
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cloudfront:TagResource",
        "cloudfront:UntagResource",
        "cloudfront:ListTagsForResource",
        "cloudfront:*OriginAccessControl",
        "cloudfront:*ResponseHeadersPolicy",
        "cloudfront:*PublicKey",
        "cloudfront:*KeyGroup",
        "cloudfront:*CachePolicy",
        "cloudfront:GetCachePolicyConfig",
        "cloudfront:*OriginRequestPolicy",
        "cloudfront:GetOriginRequestPolicyConfig",
        "cloudfront:CreateFunction",
        "cloudfront:UpdateFunction",
        "cloudfront:DeleteFunction",
        "cloudfront:DescribeFunction",
        "cloudfront:GetFunction",
        "cloudfront:PublishFunction",
        "cloudfront:AllowVendedLogDeliveryForResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "WafV2ForDiscava",
      "Effect": "Allow",
      "Action": [
        "wafv2:CreateWebACL",
        "wafv2:UpdateWebACL",
        "wafv2:DeleteWebACL",
        "wafv2:GetWebACL",
        "wafv2:AssociateWebACL",
        "wafv2:DisassociateWebACL",
        "wafv2:GetWebACLForResource",
        "wafv2:ListResourcesForWebACL",
        "wafv2:PutLoggingConfiguration",
        "wafv2:GetLoggingConfiguration",
        "wafv2:DeleteLoggingConfiguration",
        "wafv2:ListTagsForResource",
        "wafv2:TagResource",
        "wafv2:UntagResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ApiGatewayForDiscava",
      "Effect": "Allow",
      "Action": [
        "apigateway:POST",
        "apigateway:GET",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE",
        "apigateway:SetWebACL",
        "apigateway:UpdateRestApiPolicy"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CognitoUserPools",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool",
        "cognito-idp:DescribeUserPool",
        "cognito-idp:UpdateUserPool",
        "cognito-idp:DeleteUserPool",
        "cognito-idp:SetUserPoolMfaConfig",
        "cognito-idp:GetUserPoolMfaConfig",
        "cognito-idp:CreateGroup",
        "cognito-idp:GetGroup",
        "cognito-idp:UpdateGroup",
        "cognito-idp:DeleteGroup",
        "cognito-idp:CreateUserPoolClient",
        "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:DeleteUserPoolClient",
        "cognito-idp:CreateUserPoolDomain",
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:UpdateUserPoolDomain",
        "cognito-idp:DeleteUserPoolDomain",
        "cognito-idp:CreateManagedLoginBranding",
        "cognito-idp:DescribeManagedLoginBranding",
        "cognito-idp:DescribeManagedLoginBrandingByClient",
        "cognito-idp:UpdateManagedLoginBranding",
        "cognito-idp:DeleteManagedLoginBranding",
        "cognito-idp:AssociateWebACL",
        "cognito-idp:DisassociateWebACL",
        "cognito-idp:GetWebACLForResource",
        "cognito-idp:ListResourcesForWebACL",
        "cognito-idp:TagResource",
        "cognito-idp:UntagResource",
        "cognito-idp:ListTagsForResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CognitoIdentityPools",
      "Effect": "Allow",
      "Action": [
        "cognito-identity:CreateIdentityPool",
        "cognito-identity:DescribeIdentityPool",
        "cognito-identity:UpdateIdentityPool",
        "cognito-identity:DeleteIdentityPool",
        "cognito-identity:GetIdentityPoolRoles",
        "cognito-identity:SetIdentityPoolRoles",
        "cognito-identity:TagResource",
        "cognito-identity:UntagResource",
        "cognito-identity:ListTagsForResource"
      ],
      "Resource": "*"
    }
  ]
}
EOF

  # SchedulesInScheduleGroups: deleting a schedule group first deletes every
  # schedule left in it, which is authorized per schedule, not by the group.
  #
  # MediaConvertTagOnCreate: tagging a job template as it's created (stack tags
  # propagate to it) is authorized against jobTemplates/*, not the template's
  # own ARN, so it can't be scoped to COMPACT_PREFIX like the other job
  # template actions.
  cat >"$EXECUTION_COMPUTE_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaForDiscava",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunctionCodeSigningConfig",
        "lambda:GetFunctionRecursionConfig",
        "lambda:GetRuntimeManagementConfig",
        "lambda:GetPolicy",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunctionConcurrency",
        "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunctionConcurrency",
        "lambda:GetFunctionEventInvokeConfig",
        "lambda:PutFunctionEventInvokeConfig",
        "lambda:UpdateFunctionEventInvokeConfig",
        "lambda:DeleteFunctionEventInvokeConfig",
        "lambda:InvokeFunction",
        "lambda:PublishVersion",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:CreateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:UpdateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:ListVersionsByFunction",
        "lambda:ListTags",
        "lambda:TagResource",
        "lambda:UntagResource",
        "lambda:PublishLayerVersion",
        "lambda:GetLayerVersion",
        "lambda:DeleteLayerVersion"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:lambda:$AWS_REGION:$ACCOUNT_ID:function:$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:lambda:$GLOBAL_REGION:$ACCOUNT_ID:function:$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:lambda:$AWS_REGION:$ACCOUNT_ID:layer:*",
        "arn:$AWS_PARTITION:lambda:$GLOBAL_REGION:$ACCOUNT_ID:layer:*"
      ]
    },
    {
      "Sid": "EventSourceMappingsForDiscava",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateEventSourceMapping",
        "lambda:UpdateEventSourceMapping",
        "lambda:DeleteEventSourceMapping"
      ],
      "Resource": "*",
      "Condition": {
        "ArnLike": {
          "lambda:FunctionArn": "arn:$AWS_PARTITION:lambda:$AWS_REGION:$ACCOUNT_ID:function:$RESOURCE_PREFIX*"
        }
      }
    },
    {
      "Sid": "ReadEventSourceMappings",
      "Effect": "Allow",
      "Action": [
        "lambda:GetEventSourceMapping",
        "lambda:ListEventSourceMappings"
      ],
      "Resource": "*"
    },
    {
      "Sid": "SqsQueuesForDiscava",
      "Effect": "Allow",
      "Action": [
        "sqs:CreateQueue",
        "sqs:DeleteQueue",
        "sqs:*QueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ListQueueTags"
      ],
      "Resource": "arn:$AWS_PARTITION:sqs:$AWS_REGION:$ACCOUNT_ID:$RESOURCE_PREFIX*"
    },
    {
      "Sid": "CloudWatchAlarmsForDiscava",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "cloudwatch:ListTagsForResource",
        "cloudwatch:TagResource",
        "cloudwatch:UntagResource"
      ],
      "Resource": "arn:$AWS_PARTITION:cloudwatch:$AWS_REGION:$ACCOUNT_ID:alarm:$RESOURCE_PREFIX*"
    },
    {
      "Sid": "EventBridgeRulesForDiscava",
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:DeleteRule",
        "events:DescribeRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:TagResource",
        "events:UntagResource",
        "events:ListTargetsByRule"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:events:$AWS_REGION:$ACCOUNT_ID:rule/$RESOURCE_PREFIX*"
      ]
    },
    {
      "Sid": "SchedulerGroupsForDiscava",
      "Effect": "Allow",
      "Action": [
        "scheduler:CreateScheduleGroup",
        "scheduler:GetScheduleGroup",
        "scheduler:DeleteScheduleGroup",
        "scheduler:TagResource",
        "scheduler:UntagResource",
        "scheduler:ListTagsForResource"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:scheduler:$AWS_REGION:$ACCOUNT_ID:schedule-group/$COMPACT_PREFIX*"
      ]
    },
    {
      "Sid": "SchedulesInScheduleGroups",
      "Effect": "Allow",
      "Action": "scheduler:DeleteSchedule",
      "Resource": "arn:$AWS_PARTITION:scheduler:$AWS_REGION:$ACCOUNT_ID:schedule/$COMPACT_PREFIX*/*"
    },
    {
      "Sid": "AccountLevelActions",
      "Effect": "Allow",
      "Action": [
        "lambda:ListEventSourceMappings",
        "mediaconvert:DescribeEndpoints",
        "mediaconvert:CreateJobTemplate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "MediaConvertTagOnCreate",
      "Effect": "Allow",
      "Action": "mediaconvert:TagResource",
      "Resource": "arn:$AWS_PARTITION:mediaconvert:$AWS_REGION:$ACCOUNT_ID:jobTemplates/*"
    },
    {
      "Sid": "MediaConvertJobTemplatesForDiscava",
      "Effect": "Allow",
      "Action": [
        "mediaconvert:GetJobTemplate",
        "mediaconvert:UpdateJobTemplate",
        "mediaconvert:DeleteJobTemplate",
        "mediaconvert:TagResource",
        "mediaconvert:UntagResource",
        "mediaconvert:ListTagsForResource"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:mediaconvert:$AWS_REGION:$ACCOUNT_ID:jobTemplates/$COMPACT_PREFIX*"
      ]
    },
    {
      "Sid": "StageSettingsParameters",
      "Effect": "Allow",
      "Action": [
        "ssm:PutParameter",
        "ssm:DeleteParameter",
        "ssm:GetParameters",
        "ssm:AddTagsToResource",
        "ssm:RemoveTagsFromResource",
        "ssm:ListTagsForResource"
      ],
      "Resource": "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/$TARGET_STAGE/*"
    }
  ]
}
EOF
}

attach_execution_policy() {
  create_execution_policy_files

  # Attached before the inline policy is replaced, so a stage set up before
  # the split never loses a permission in between.
  local name file
  for name in "$EXECUTION_DATA_POLICY_NAME" "$EXECUTION_EDGE_POLICY_NAME" "$EXECUTION_COMPUTE_POLICY_NAME"; do
    file="$POLICY_DIR/$name.json"
    upsert_managed_policy "$name" "$file" \
      "CloudFormation execution permissions for $TARGET_STAGE"
    echo "Attaching $name to: $EXECUTION_ROLE_NAME"
    aws iam attach-role-policy \
      --role-name "$EXECUTION_ROLE_NAME" \
      --policy-arn "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:policy/$name"
  done

  echo "Attaching execution policy to: $EXECUTION_ROLE_NAME"
  aws iam put-role-policy \
    --role-name "$EXECUTION_ROLE_NAME" \
    --policy-name DiscavaCloudFormationExecutionPolicy \
    --policy-document "file://$EXECUTION_POLICY_FILE"
}

# The permissions boundary every role in the stage's stacks carries: the most
# those roles (and so anything the execution role creates) can ever do. It
# covers what the application's roles use, scoped to this stage's resources
# wherever the resource name allows. Extend it when the app needs a new action;
# the execution role can't modify it.
#
# Grants made to a role ARN in a resource policy (e.g. a bucket policy) are
# capped by the boundary too, so it also covers those: CDK's S3 auto-delete
# provider is granted s3:PutBucketPolicy by each auto-deleted bucket's policy,
# and uses it to deny new uploads before emptying the bucket.
upsert_boundary_policy() {
  BOUNDARY_POLICY_FILE="$POLICY_DIR/${BOUNDARY_POLICY_NAME}.json"

  cat >"$BOUNDARY_POLICY_FILE" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LogsAndTracing",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
        "xray:PutTraceSegments",
        "xray:PutTelemetryRecords"
      ],
      "Resource": "*"
    },
    {
      "Sid": "StageTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem",
        "dynamodb:DeleteItem",
        "dynamodb:DescribeStream",
        "dynamodb:DescribeTable",
        "dynamodb:GetItem",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:$AWS_PARTITION:dynamodb:$AWS_REGION:$ACCOUNT_ID:table/$RESOURCE_PREFIX*"
    },
    {
      "Sid": "ListTableStreams",
      "Effect": "Allow",
      "Action": "dynamodb:ListStreams",
      "Resource": "*"
    },
    {
      "Sid": "StageSettingsParameterRead",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/$TARGET_STAGE/*"
    },
    {
      "Sid": "StageQueues",
      "Effect": "Allow",
      "Action": [
        "sqs:ChangeMessageVisibility",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
        "sqs:ReceiveMessage",
        "sqs:SendMessage"
      ],
      "Resource": "arn:$AWS_PARTITION:sqs:$AWS_REGION:$ACCOUNT_ID:$RESOURCE_PREFIX*"
    },
    {
      "Sid": "StageBuckets",
      "Effect": "Allow",
      "Action": [
        "s3:Abort*",
        "s3:DeleteObject*",
        "s3:GetBucket*",
        "s3:GetObject*",
        "s3:List*",
        "s3:PutObject*"
      ],
      "Resource": "arn:$AWS_PARTITION:s3:::$BUCKET_PREFIX*"
    },
    {
      "Sid": "AutoDeleteBlocksNewWrites",
      "Effect": "Allow",
      "Action": "s3:PutBucketPolicy",
      "Resource": "arn:$AWS_PARTITION:s3:::$BUCKET_PREFIX*"
    },
    {
      "Sid": "ReadStageAssets",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucket*",
        "s3:GetObject*",
        "s3:List*"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY",
        "arn:$AWS_PARTITION:s3:::$ASSETS_BUCKET_PRIMARY/$ASSETS_PREFIX*"
      ]
    },
    {
      "Sid": "StageFunctions",
      "Effect": "Allow",
      "Action": [
        "lambda:GetFunction",
        "lambda:InvokeFunction"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:lambda:$AWS_REGION:$ACCOUNT_ID:function:$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:lambda:$GLOBAL_REGION:$ACCOUNT_ID:function:$RESOURCE_PREFIX*"
      ]
    },
    {
      "Sid": "StageSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:CreateSecret",
        "secretsmanager:DeleteSecret",
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:UpdateSecret",
        "secretsmanager:UpdateSecretVersionStage"
      ],
      "Resource": "arn:$AWS_PARTITION:secretsmanager:$AWS_REGION:$ACCOUNT_ID:secret:$COMPACT_PREFIX*"
    },
    {
      "Sid": "StageCrossRegionExports",
      "Effect": "Allow",
      "Action": [
        "ssm:AddTagsToResource",
        "ssm:DeleteParameters",
        "ssm:GetParameters",
        "ssm:ListTagsForResource",
        "ssm:PutParameter",
        "ssm:RemoveTagsFromResource"
      ],
      "Resource": [
        "arn:$AWS_PARTITION:ssm:$AWS_REGION:$ACCOUNT_ID:parameter/cdk/exports/$RESOURCE_PREFIX*",
        "arn:$AWS_PARTITION:ssm:$GLOBAL_REGION:$ACCOUNT_ID:parameter/cdk/exports/$RESOURCE_PREFIX*"
      ]
    },
    {
      "Sid": "StageSchedules",
      "Effect": "Allow",
      "Action": [
        "scheduler:CreateSchedule",
        "scheduler:UpdateSchedule"
      ],
      "Resource": "arn:$AWS_PARTITION:scheduler:$AWS_REGION:$ACCOUNT_ID:schedule/$COMPACT_PREFIX*"
    },
    {
      "Sid": "PassStageRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$RESOURCE_PREFIX*"
    },
    {
      "Sid": "ReadRoles",
      "Effect": "Allow",
      "Action": "iam:GetRole",
      "Resource": "*"
    },
    {
      "Sid": "ApiGatewayAccountSettings",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:PATCH"
      ],
      "Resource": "arn:$AWS_PARTITION:apigateway:$AWS_REGION::/account"
    },
    {
      "Sid": "SearchCollectionDataPlane",
      "Effect": "Allow",
      "Action": "aoss:APIAccessAll",
      "Resource": "arn:$AWS_PARTITION:aoss:$AWS_REGION:$ACCOUNT_ID:collection/*"
    },
    {
      "Sid": "ResourcesNamedById",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateInvalidation",
        "cloudfront:GetInvalidation",
        "cognito-idp:AdminAddUserToGroup",
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
        "mediaconvert:CancelJob",
        "mediaconvert:CreateJob",
        "mediaconvert:GetJob",
        "sns:Publish",
        "transcribe:GetTranscriptionJob",
        "transcribe:StartTranscriptionJob",
        "transcribe:TagResource",
        "translate:TranslateText"
      ],
      "Resource": "*"
    },
    {
      "Sid": "NotificationEmail",
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:$AWS_PARTITION:ses:$AWS_REGION:$ACCOUNT_ID:identity/*"
    }
  ]
}
EOF

  upsert_managed_policy "$BOUNDARY_POLICY_NAME" "$BOUNDARY_POLICY_FILE" \
    "Permissions boundary for $TARGET_STAGE's IAM roles"
}

bootstrap_cdk() {
  local region
  for region in ${BOOTSTRAP_REGIONS[@]+"${BOOTSTRAP_REGIONS[@]}"}; do
    echo "Bootstrapping CDK in $region"
    (cd "$REPO_ROOT" && pnpm exec cdk bootstrap "aws://$ACCOUNT_ID/$region" --qualifier "$CDK_QUALIFIER")
  done
}

configure_github_environment() {
  echo "Creating GitHub environment: $TARGET_STAGE"
  gh api --method PUT "repos/$GITHUB_REPOSITORY/environments/$TARGET_STAGE" >/dev/null

  local name value
  for name in AWS_REGION AWS_DEPLOY_ROLE_ARN AWS_EXECUTION_ROLE_ARN; do
    case "$name" in
      AWS_REGION) value="$AWS_REGION" ;;
      AWS_DEPLOY_ROLE_ARN) value="$DEPLOY_ROLE_ARN" ;;
      AWS_EXECUTION_ROLE_ARN) value="$EXECUTION_ROLE_ARN" ;;
    esac
    gh variable set "$name" --repo "$GITHUB_REPOSITORY" --env "$TARGET_STAGE" --body "$value"
  done

  if [[ "$SET_AUTO_DEPLOY" == true ]]; then
    gh variable set AUTO_DEPLOY_STAGE --repo "$GITHUB_REPOSITORY" --body "$TARGET_STAGE"
  fi
  gh variable set AWS_DOCKER_LOGIN_ROLE_ARN --repo "$GITHUB_REPOSITORY" --body "$DOCKER_LOGIN_ROLE_ARN"

  local variable
  for variable in ${DOMAIN_VARIABLES[@]+"${DOMAIN_VARIABLES[@]}"}; do
    gh variable set "${variable%%=*}" --repo "$GITHUB_REPOSITORY" --env "$TARGET_STAGE" --body "${variable#*=}"
  done
  for variable in ${DOMAIN_VARIABLES_TO_DELETE[@]+"${DOMAIN_VARIABLES_TO_DELETE[@]}"}; do
    gh variable delete "$variable" --repo "$GITHUB_REPOSITORY" --env "$TARGET_STAGE"
  done
}

print_next_steps() {
  echo ""
  echo "Complete."
  if [[ "$CONFIGURE_GITHUB" == false ]]; then
    echo "Create a GitHub environment named '$TARGET_STAGE' in $GITHUB_REPOSITORY with:"
    echo "  Variable:   AWS_REGION=$AWS_REGION"
    echo "  Variable:   AWS_DEPLOY_ROLE_ARN=$DEPLOY_ROLE_ARN"
    echo "  Variable:   AWS_EXECUTION_ROLE_ARN=$EXECUTION_ROLE_ARN"
    local variable
    for variable in ${DOMAIN_VARIABLES[@]+"${DOMAIN_VARIABLES[@]}"}; do
      echo "  Variable:   $variable"
    done
    for variable in ${DOMAIN_VARIABLES_TO_DELETE[@]+"${DOMAIN_VARIABLES_TO_DELETE[@]}"}; do
      echo "  Remove:     $variable"
    done
    echo "and the repository variable:"
    echo "  Variable:   AWS_DOCKER_LOGIN_ROLE_ARN=$DOCKER_LOGIN_ROLE_ARN"
    paragraph "To deploy it automatically whenever CI passes on main, also set the repository variable AUTO_DEPLOY_STAGE=$TARGET_STAGE."
    echo ""
  fi
  if [[ ${#DOMAIN_VARIABLES[@]} -gt 0 ]]; then
    paragraph "After the next deploy, point each custom domain's DNS record at its API Gateway custom domain or CloudFront distribution; until then the domains won't resolve, although the portals and signed media URLs already use them."
    echo ""
  fi
  paragraph "Anyone who can run workflows can deploy this stage. For production-like stages, add required reviewers and restrict deployments to main at:"
  echo "  https://github.com/$GITHUB_REPOSITORY/settings/environments"
  echo ""
  echo "Deploy from the Actions tab (Deploy > Run workflow), or:"
  echo "  gh workflow run deploy.yml --repo $GITHUB_REPOSITORY -f stage=$TARGET_STAGE"
}

readonly DEPLOY_ROLE_ARN="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$DEPLOY_ROLE_NAME"
readonly EXECUTION_ROLE_ARN="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$EXECUTION_ROLE_NAME"
readonly DOCKER_LOGIN_ROLE_ARN="arn:$AWS_PARTITION:iam::$ACCOUNT_ID:role/$DOCKER_LOGIN_ROLE_NAME"

confirm
bootstrap_cdk
ensure_oidc_provider
upsert_boundary_policy
create_policy_files
upsert_role \
  "$DEPLOY_ROLE_NAME" \
  "$DEPLOY_TRUST_POLICY_FILE" \
  "GitHub Actions deploy role for $GITHUB_REPOSITORY ($TARGET_STAGE)"
attach_inline_policy
upsert_role \
  "$EXECUTION_ROLE_NAME" \
  "$EXECUTION_TRUST_POLICY_FILE" \
  "CloudFormation execution role for $GITHUB_REPOSITORY ($TARGET_STAGE)"
attach_execution_policy
create_docker_login_policy_files
upsert_role \
  "$DOCKER_LOGIN_ROLE_NAME" \
  "$DOCKER_LOGIN_TRUST_POLICY_FILE" \
  "GitHub Actions ECR Public login role for $GITHUB_REPOSITORY" \
  ""
attach_docker_login_policy
if [[ "$CONFIGURE_GITHUB" == true ]]; then
  configure_github_environment
fi
print_next_steps
