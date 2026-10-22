/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@discava/common-shadcn/components/ui/dropdown-menu';
import { Toggle } from '@discava/common-shadcn/components/ui/toggle';
import { cn } from '@discava/common-shadcn/lib/utils';
import {
  createContentExtensions,
  parseTiptapDocument,
} from '@discava/common-tiptap';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { Bold, Heading2, Italic, List, ListOrdered, Sigma } from 'lucide-react';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { MathPopover } from './math-popover';

// The formula being written or edited in the maths popover: a new one at the
// cursor, or the one at `pos`.
interface MathEdit {
  display: boolean;
  latex?: string;
  pos?: number;
  anchor: () => DOMRect;
}

/**
 * A minimal Tiptap-based rich text editor for authoring a text content
 * item's body. Controlled by `value` (Tiptap's JSON document, stringified --
 * see #111), emitting the same shape via `onChange`. Its extensions are
 * @discava/common-tiptap's, which instructor-api validates against, so
 * whatever it produces can be saved: formatting, lists and LaTeX formulas
 * (the Maths button, `$$…$$` inline or `$$$…$$$` on a line of its own).
 */
export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  minHeightClass = 'min-h-32',
}: {
  value: string | undefined;
  onChange: (body: string) => void;
  // What the editing area is called to assistive technology, e.g. "Question 2".
  // Required: an unnamed editor is announced as just "editable" (#238).
  ariaLabel: string;
  minHeightClass?: string;
}) {
  const [mathEdit, setMathEdit] = useState<MathEdit>();
  const mathButtonRef = useRef<HTMLButtonElement>(null);
  // Which kind of formula was picked from the Maths menu, until it closes.
  const pendingFormula = useRef<boolean>(undefined);
  const editorRef = useRef<Editor | null>(null);
  // Clicking a formula opens the popover on it, to edit or delete it.
  const extensions = useMemo(
    () =>
      createContentExtensions({
        onMathClick: (node, pos) => {
          const dom = editorRef.current?.view.nodeDOM(pos);
          setMathEdit({
            display: node.type.name === 'blockMath',
            latex: node.attrs.latex,
            pos,
            anchor: () =>
              dom instanceof HTMLElement
                ? dom.getBoundingClientRect()
                : new DOMRect(),
          });
        },
      }),
    [],
  );
  const editor = useEditor({
    extensions,
    content: parseTiptapDocument(value),
    onUpdate: ({ editor }) => {
      onChange(JSON.stringify(editor.getJSON()));
    },
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none px-3 py-2 focus:outline-none',
          minHeightClass,
        ),
        'aria-label': ariaLabel,
      },
    },
  });
  editorRef.current = editor;

  const newFormula = (display: boolean) =>
    setMathEdit({
      display,
      anchor: () =>
        mathButtonRef.current?.getBoundingClientRect() ?? new DOMRect(),
    });

  const confirmFormula = (latex: string) => {
    if (!editor || !mathEdit) {
      return;
    }
    const { display, pos } = mathEdit;
    const chain = editor.chain().focus();
    if (pos === undefined) {
      (display
        ? chain.insertBlockMath({ latex })
        : chain.insertInlineMath({ latex })
      ).run();
    } else {
      (display
        ? chain.updateBlockMath({ latex, pos })
        : chain.updateInlineMath({ latex, pos })
      ).run();
    }
    setMathEdit(undefined);
  };

  const deleteFormula = () => {
    if (!editor || mathEdit?.pos === undefined) {
      return;
    }
    const { display, pos } = mathEdit;
    const chain = editor.chain().focus();
    (display
      ? chain.deleteBlockMath({ pos })
      : chain.deleteInlineMath({ pos })
    ).run();
    setMathEdit(undefined);
  };

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-1 border-b bg-muted/50 px-2 py-1">
        <ToolbarButton
          label="Bold"
          active={editor?.isActive('bold')}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold />
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          active={editor?.isActive('italic')}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic />
        </ToolbarButton>
        <ToolbarButton
          label="Heading"
          active={editor?.isActive('heading', { level: 2 })}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          <Heading2 />
        </ToolbarButton>
        <ToolbarButton
          label="Bullet list"
          active={editor?.isActive('bulletList')}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor?.isActive('orderedList')}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered />
        </ToolbarButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={mathButtonRef}
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Maths"
            >
              <Sigma />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            // The popover opens once the menu has fully closed: opened while
            // the menu is still closing, the menu's focus handling dismisses
            // it at once. Focus then goes to the popover, not back here.
            onCloseAutoFocus={(event) => {
              const display = pendingFormula.current;
              pendingFormula.current = undefined;
              if (display !== undefined) {
                event.preventDefault();
                newFormula(display);
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                pendingFormula.current = false;
              }}
            >
              Inline formula
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                pendingFormula.current = true;
              }}
            >
              Block formula
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <EditorContent editor={editor} />
      {mathEdit ? (
        <MathPopover
          key={mathEdit.pos ?? 'new'}
          anchor={mathEdit.anchor}
          display={mathEdit.display}
          latex={mathEdit.latex}
          onConfirm={confirmFormula}
          onDelete={mathEdit.pos === undefined ? undefined : deleteFormula}
          onClose={() => setMathEdit(undefined)}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Toggle
      size="sm"
      aria-label={label}
      pressed={Boolean(active)}
      onPressedChange={onClick}
    >
      {children}
    </Toggle>
  );
}
