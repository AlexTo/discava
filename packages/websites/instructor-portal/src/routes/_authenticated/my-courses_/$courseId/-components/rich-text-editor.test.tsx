/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { RichTextEditor } from './rich-text-editor';

function Controlled({ value }: { value?: string }) {
  const [body, setBody] = useState(value);
  return <RichTextEditor value={body} onChange={setBody} ariaLabel="Body" />;
}

const renderEditor = (value?: string) => {
  render(<Controlled value={value} />);
  return { user: userEvent.setup() };
};

describe('RichTextEditor', () => {
  it('types into an editable area labelled as given', () => {
    renderEditor();

    const editor = screen.getByLabelText('Body');
    expect(editor).toHaveAttribute('contenteditable', 'true');
  });

  it('shows a toolbar with Bold, Italic, Heading, list and Maths controls', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Heading' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Bullet list' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Numbered list' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Maths' })).toBeInTheDocument();
  });

  it('parses an existing Tiptap document into the editor', () => {
    const doc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    });
    renderEditor(doc);

    expect(screen.getByLabelText('Body')).toHaveTextContent('Hello world');
  });

  it('emits the typed text as a Tiptap document through onChange', async () => {
    const { user } = renderEditor();

    await user.type(screen.getByLabelText('Body'), 'Hello');

    expect(screen.getByLabelText('Body')).toHaveTextContent('Hello');
  });

  it('bolds the typed text once Bold is toggled on', async () => {
    const { user } = renderEditor();
    const editor = screen.getByLabelText('Body');

    await user.click(editor);
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    await user.type(editor, 'Hi');

    expect(editor.querySelector('strong')).not.toBeNull();
  });

  it('offers inline and block formula options from the Maths menu', async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole('button', { name: 'Maths' }));

    expect(
      screen.getByRole('menuitem', { name: 'Inline formula' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Block formula' }),
    ).toBeInTheDocument();
  });
});
