# @discava/infra
This library was generated with [@aws/nx-plugin](https://github.com/awslabs/nx-plugin-for-aws/).

## Building

Run `pnpm nx build @discava/infra [--skip-nx-cache]` to build the application.

## Running unit tests

Run `pnpm nx test @discava/infra` to execute the unit tests via Vitest.

### Updating snapshots

To update snapshots, run the following command:

`pnpm nx test @discava/infra -u`

## Run lint

Run `pnpm nx lint @discava/infra`

### Fixable issues

You can also automatically fix some lint errors by running the following command:

`pnpm nx lint @discava/infra --configuration=fix`

## Deploy to AWS

### Deploy all Stacks in a Stage

Run `pnpm nx deploy @discava/infra "[stageName]/*"`, where the stages (`discava-development`, `discava-production`) are defined in `packages/common/infra-config/src/stages.config.ts`

### Deploy a single Stack

Run `pnpm nx deploy @discava/infra [stageName]/[stackName]`

### Hotswap deployment

> [!CAUTION]
> Not to be used in production deployments

Use the --hotswap flag with the deploy target to attempt to update your AWS resources directly instead of generating an AWS CloudFormation change set and deploying it. Deployment falls back to AWS CloudFormation deployment if hot swapping is not possible.

Currently hot swapping supports Lambda functions, Step Functions state machines, and Amazon ECS container images. The --hotswap flag also disables rollback (i.e., implies --no-rollback).

Run `pnpm nx deploy @discava/infra "discava-development/*" --hotswap`

## Checkov Rule Suppressions

There may be instances where you want to suppress certain rules on resources. You can do this in two ways:

### Suppress a rule on a given construct

```typescript
import { suppressRules } from '@discava/common-constructs';

...
// suppresses the RULE_NAME for the given construct.
suppressRules(construct, ['RULE_NAME'], 'Reason');
```

### Suppress a rule on a descendant construct

```typescript
import { suppressRules } from '@discava/common-constructs';

...
// Suppresses the RULE_NAME for the construct or any of its descendants if it is an instance of Bucket
suppressRules(construct, ['RULE_NAME'], 'Reason', (construct) => construct instanceof Bucket);
```

## Useful links

- [Infra reference docs](https://awslabs.github.io/nx-plugin-for-aws/en/guides/typescript-infrastructure/)
- [Learn more about NX](https://nx.dev/getting-started/intro)
