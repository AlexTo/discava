# @discava/docs

Documentation site generated with [@aws/nx-plugin](https://github.com/awslabs/nx-plugin-for-aws/),
powered by [Astro](https://astro.build/) and [Starlight](https://starlight.astro.build/).

## Run locally

```bash
pnpm nx start @discava/docs
```

## Build for production

```bash
pnpm nx build @discava/docs
```

## Preview the production build

```bash
pnpm nx preview @discava/docs
```

## Translate documentation

This project is pre-wired with a translation script that uses a
[Strands Agent](https://strandsagents.com/) powered by Claude on
[Amazon Bedrock](https://aws.amazon.com/bedrock/) to translate documentation from
the source language (`en` by default) into every locale listed in
`scripts/translate.config.json`.

The `targetLanguages` list holds the locales the site ships (`jp`, `ko`, `es`,
`pt`, `fr`, `it`, `zh`, `vi`). Each locale listed there must also be configured
in `astro.config.mjs` under `locales`.

Run the translator manually with:

```bash
pnpm nx translate @discava/docs -- --all
```

Translate only the files changed on your branch since it left `main`, or since
the branch's last `docs: update translations` commit:

```bash
pnpm nx translate @discava/docs
```

Other options in `scripts/translate.config.json`:

- `include` / `exclude` — glob patterns for docs files, relative to the source
  language directory.
- `modelId` — Bedrock model id.
- `awsRegion` — Bedrock region; can be overridden with the `AWS_REGION` env var.
- `concurrency` — cap on concurrent Bedrock requests (one agent per file ×
  target language).

