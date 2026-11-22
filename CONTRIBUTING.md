# Contributing Guidelines

Thank you for your interest in Discava. We value your ideas and bug reports, but please read this first: Discava does not take outside pull requests or issues.

## We Don't Accept Pull Requests

Discava is built by a strict, automated development pipeline: specs become issues, agents pick up the issues and open pull requests, CI reports back, and a maintainer reviews every change. The pipeline is documented at [AlexTo/agentic-sdlc](https://github.com/AlexTo/agentic-sdlc). A pull request from outside it has no place in that flow, so only collaborators can open pull requests here.

## We Don't Accept Issues

Agents read and act on this repository's issues, so text in an issue becomes instructions to an agent. Accepting issues from anyone would open the pipeline to prompt injection. Only collaborators can open issues here.

## Ideas, Questions and Bug Reports

Post them in [GitHub Discussions](https://github.com/AlexTo/discava/discussions):

- [Ideas](https://github.com/AlexTo/discava/discussions/categories/ideas) for new features and improvements
- [Q&A](https://github.com/AlexTo/discava/discussions/categories/q-a) for questions about running or deploying Discava
- [General](https://github.com/AlexTo/discava/discussions/categories/general) for bug reports and anything else

A maintainer reads every discussion and turns the ones we take on into specs and issues. Before posting, search existing discussions to see if someone has raised it already. For a bug report, details like these help:

- A reproducible test case or series of steps
- The stage/environment you hit it in (`discava-development` vs `discava-production`, local vs deployed)
- Any modifications you've made relevant to the bug
- Anything unusual about your environment or setup

Security issues don't go in Discussions; see [Security Issue Notifications](#security-issue-notifications).

## Code of Conduct

This project has adopted the [Contributor Covenant](CODE_OF_CONDUCT.md). Please read it before participating, and report unacceptable behavior as described there.

## Security Issue Notifications

See [SECURITY.md](SECURITY.md) for how to report a potential security issue. Please do not post it in a public discussion.

## Licensing

See the [LICENSE](LICENSE) file for our project's licensing (Apache License 2.0).
