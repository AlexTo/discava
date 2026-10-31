<div align="center">
  <h1>Discava</h1>
  <h3>The serverless, AI-native Learning Management System</h3>
  <a href="https://opensource.org/licenses/Apache-2.0">
    <img
      src="https://img.shields.io/badge/License-Apache%202.0-yellowgreen.svg"
      alt="Apache 2.0 License"
    />
  </a>
  <a href="https://codecov.io/github/AlexTo/discava">
    <img
      src="https://codecov.io/github/AlexTo/discava/graph/badge.svg?token=LOOB6GNM8P"
      alt="Codecov coverage"
    />
  </a>
  <a href="https://github.com/AlexTo/discava/actions/workflows/ci.yml">
    <img
      src="https://github.com/AlexTo/discava/actions/workflows/ci.yml/badge.svg"
      alt="Release badge"
    />
  </a>
  <a href="https://github.com/AlexTo/discava/commits/main">
    <img
      src="https://img.shields.io/github/commit-activity/w/AlexTo/discava"
      alt="Commit activity"
    />
  </a>
</div>

---

> [!IMPORTANT]
> Discava is under active development and is not yet feature complete. Expect breaking changes and rough edges until a stable release is tagged.

**Discava** is a free and open source, serverless, AWS-native Learning Management System: course delivery, enrolment, and student/instructor/admin portals, deployable to your own AWS account.

It's opinionated by design: one cloud provider, one way to deploy, rather than a pluggable backend you configure yourself. The trade-off is deliberate, easier to deploy and fewer integration quirks, instead of maximum backend flexibility. And it's built with agentic AI from the start rather than bolted on later: an AI assistant and personalised learning are part of the core experience, not a paid add-on.

## Tech stack

- [Nx](https://nx.dev) monorepo ([pnpm](https://pnpm.io) workspaces), built with [`@aws/nx-plugin`](https://awslabs.github.io/nx-plugin-for-aws)
- Serverless AWS: [Lambda](https://aws.amazon.com/lambda/), [DynamoDB](https://aws.amazon.com/dynamodb/) ([ElectroDB](https://electrodb.dev)), [Cognito](https://aws.amazon.com/cognito/), [CDK](https://aws.amazon.com/cdk/) infra
- Search: [Amazon OpenSearch Serverless](https://aws.amazon.com/opensearch-service/features/serverless/) on NextGen collections, which scale all the way to zero when idle (no cost between searches), kept in sync from the DynamoDB stream
- [React](https://react.dev) + [Vite](https://vite.dev) frontends with [TanStack Router](https://tanstack.com/router), [Tailwind](https://tailwindcss.com), and [shadcn/ui](https://ui.shadcn.com)
- [tRPC](https://trpc.io) API
- Agentic AI: [Amazon Bedrock](https://aws.amazon.com/bedrock/), [Bedrock AgentCore](https://aws.amazon.com/bedrock/agentcore/), and [Strands Agents](https://strandsagents.com) powering the in-app assistant and personalised learning paths

## Documentation

Full documentation, including architecture and guides, lives at the [Discava docs site](https://alexto.github.io/discava/).

## License

Apache License 2.0, see [LICENSE](LICENSE).

## Contributing

Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).
