# @discava/docs

Documentation site generated with [@aws/nx-plugin](https://github.com/awslabs/nx-plugin-for-aws/),
powered by [Astro](https://astro.build/) and [Starlight](https://starlight.astro.build/).

## Run locally

```bash
pnpm nx start @discava/docs
```

`astro dev` serves the site at the root of `http://localhost:4321`.

## Build for production

The build reads two environment variables, which CI sets from the repository
(see `.github/workflows/ci.yml`):

- `DOCS_SITE`: the origin the site is published at, such as
  `https://alexto.github.io`. Unset, canonical URLs and the sitemap are left out.
- `DOCS_BASE_PATH`: the path under it, such as `/discava`. Unset, the site is
  built for the root.


```bash
pnpm nx build @discava/docs
```

## Preview the production build

```bash
pnpm nx preview @discava/docs
```
