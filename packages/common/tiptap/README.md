# @discava/common-tiptap

The rich text format shared by everything that writes, stores or shows course content: lesson text, quiz prompts and explanations.

- `createContentExtensions()`: the Tiptap extensions behind every document, StarterKit plus [Mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) (LaTeX formulas rendered with KaTeX, stored as `inlineMath` / `blockMath` nodes with a `latex` attribute). The instructor portal's editor, the student portal's renderer and instructor-api's validation all use it, so whatever can be written can be stored and shown.
- `isValidTiptapDocument()`: whether a stored JSON string conforms to that schema. instructor-api validates text bodies and quiz prompts and explanations with it.
- `parseTiptapDocument()`: a stored document's JSON, or `undefined` when it's missing or doesn't parse.
- `renderLatex()`: LaTeX rendered with KaTeX, or KaTeX's explanation of why it can't be, for previews.

Portals that show formulas also import KaTeX's stylesheet: `import 'katex/dist/katex.min.css'`.

Adding an extension changes what documents may contain, so do it here, never in one consumer.

## Building and testing

```sh
pnpm nx run @discava/common-tiptap:build
pnpm nx run @discava/common-tiptap:test
```
