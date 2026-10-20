/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Label } from '@discava/common-shadcn/components/ui/label';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@discava/common-shadcn/components/ui/popover';
import { Textarea } from '@discava/common-shadcn/components/ui/textarea';
import { renderLatex } from '@discava/common-tiptap';
import 'katex/dist/katex.min.css';
import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';

// LaTeX for the most common constructs, so writing a formula doesn't need
// LaTeX by heart: each button inserts its snippet at the cursor.
export const MATH_SNIPPETS = [
  { label: 'a/b', name: 'Fraction', latex: '\\frac{a}{b}' },
  { label: '√x', name: 'Square root', latex: '\\sqrt{x}' },
  { label: 'x²', name: 'Power', latex: 'x^{2}' },
  { label: 'xᵢ', name: 'Subscript', latex: 'x_{i}' },
  { label: 'Σ', name: 'Sum', latex: '\\sum_{i=1}^{n}' },
  { label: '∫', name: 'Integral', latex: '\\int_{a}^{b}' },
  {
    label: '[ ]',
    name: 'Matrix',
    latex: '\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}',
  },
  { label: 'α', name: 'Alpha', latex: '\\alpha' },
  { label: 'β', name: 'Beta', latex: '\\beta' },
  { label: 'θ', name: 'Theta', latex: '\\theta' },
  { label: 'π', name: 'Pi', latex: '\\pi' },
  { label: '≤', name: 'Less than or equal to', latex: '\\leq' },
  { label: '≠', name: 'Not equal to', latex: '\\neq' },
] as const;

export interface MathPopoverProps {
  // Where the popover points: the toolbar button for a new formula, the
  // formula itself when editing one.
  anchor: () => DOMRect;
  // A block formula (its own line) rather than one within the text.
  display: boolean;
  // The formula being edited, or undefined for a new one.
  latex?: string;
  onConfirm: (latex: string) => void;
  // Only offered when editing an existing formula.
  onDelete?: () => void;
  onClose: () => void;
}

// Writing or editing one formula: its LaTeX, buttons for common snippets,
// and a live preview rendered the way it will appear. Done stays disabled
// while the LaTeX is empty or can't be rendered, so no broken formula is
// saved. Enter confirms an inline formula (Shift+Enter for a new line);
// Ctrl/⌘+Enter confirms either kind.
export function MathPopover({
  anchor,
  display,
  latex: initialLatex,
  onConfirm,
  onDelete,
  onClose,
}: MathPopoverProps) {
  const [latex, setLatex] = useState(initialLatex ?? '');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  const editing = initialLatex !== undefined;
  const trimmed = latex.trim();
  const rendered = useMemo(
    () => (trimmed ? renderLatex(trimmed, { display }) : undefined),
    [trimmed, display],
  );
  const canConfirm = rendered !== undefined && 'html' in rendered;

  const confirm = () => {
    if (canConfirm) {
      onConfirm(trimmed);
    }
  };

  const insertSnippet = (snippet: string) => {
    const field = textareaRef.current;
    const start = field?.selectionStart ?? latex.length;
    const end = field?.selectionEnd ?? latex.length;
    setLatex(latex.slice(0, start) + snippet + latex.slice(end));
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + snippet.length, start + snippet.length);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey || (!display && !event.shiftKey))
    ) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor
        virtualRef={{ current: { getBoundingClientRect: anchor } }}
      />
      <PopoverContent
        align="start"
        className="w-96 space-y-3"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textareaRef.current?.focus();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={fieldId}>
            {display ? 'Block formula' : 'Inline formula'} (LaTeX)
          </Label>
          <Textarea
            id={fieldId}
            ref={textareaRef}
            value={latex}
            onChange={(event) => setLatex(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. \frac{a}{b}"
            rows={display ? 3 : 2}
            spellCheck={false}
            className="font-mono text-sm"
          />
        </div>
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Insert a snippet</legend>
          {MATH_SNIPPETS.map((snippet) => (
            <Button
              key={snippet.name}
              type="button"
              variant="outline"
              size="xs"
              className="min-w-8"
              aria-label={snippet.name}
              title={`${snippet.name}: ${snippet.latex}`}
              onClick={() => insertSnippet(snippet.latex)}
            >
              {snippet.label}
            </Button>
          ))}
        </fieldset>
        <section
          aria-label="Preview"
          aria-live="polite"
          className="min-h-12 overflow-x-auto rounded-md border bg-muted/30 px-3 py-2 text-center"
        >
          {!rendered ? (
            <p className="text-sm text-muted-foreground">
              The formula appears here as you type.
            </p>
          ) : 'html' in rendered ? (
            // KaTeX's output, with `trust` off: no links or raw HTML.
            <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <p role="alert" className="text-left text-sm text-destructive">
              {rendered.error}
            </p>
          )}
        </section>
        <div className="flex items-center gap-2">
          {editing && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canConfirm}
            onClick={confirm}
          >
            {editing ? 'Update' : 'Insert'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
