/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithInstructorApi } from '../../../../../../../../test/render-with-instructor-api';
import { FilePreview } from './file-preview';

let pdfFails = false;
vi.mock('./pdf-preview', () => ({
  PdfPreview: ({ url, onError }: { url: string; onError: () => void }) => {
    if (pdfFails) {
      queueMicrotask(onError);
    }
    return <div data-testid="pdf">{url}</div>;
  },
}));

const ref = { courseId: 'c1', contentItemId: 'i1', userId: 'u1' };
const file = (over = {}) => ({
  fileName: 'essay.pdf',
  fileSize: 2048,
  mimeType: 'application/pdf',
  previewable: 'pdf' as 'pdf' | 'image' | null,
  ...over,
});
const handlers = {
  'assignmentSubmission.fileUrl': () => ({ url: 'https://files.test/a' }),
};

describe('FilePreview', () => {
  it('shows an image in an img', async () => {
    renderWithInstructorApi(
      <FilePreview
        {...ref}
        file={file({ fileName: 'a.png', previewable: 'image' })}
      />,
      { handlers },
    );

    const img = await screen.findByRole('img', { name: /a\.png/ });
    expect(img).toHaveAttribute('src', 'https://files.test/a');
  });

  it('loads a PDF through the lazy preview', async () => {
    pdfFails = false;
    renderWithInstructorApi(<FilePreview {...ref} file={file()} />, {
      handlers,
    });

    expect(await screen.findByTestId('pdf')).toHaveTextContent(
      'https://files.test/a',
    );
  });

  it('offers only the details and Download for any other type', async () => {
    const { calls } = renderWithInstructorApi(
      <FilePreview
        {...ref}
        file={file({
          fileName: 'a.docx',
          mimeType: 'application/msword',
          previewable: null,
        })}
      />,
      { handlers },
    );

    expect(screen.getByText('a.docx')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download' })).toBeVisible();
    expect(screen.queryByTestId('pdf')).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('falls back to Download when the PDF fails to load', async () => {
    pdfFails = true;
    renderWithInstructorApi(<FilePreview {...ref} file={file()} />, {
      handlers,
    });

    expect(
      await screen.findByText("This file can't be previewed"),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Download' })).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByTestId('pdf')).not.toBeInTheDocument(),
    );
  });

  it('fetches a fresh URL on Download', async () => {
    pdfFails = false;
    const { calls, user } = renderWithInstructorApi(
      <FilePreview {...ref} file={file({ previewable: null })} />,
      { handlers },
    );

    await user.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() =>
      expect(
        calls.filter((c) => c.path === 'assignmentSubmission.fileUrl'),
      ).toHaveLength(1),
    );
  });
});
