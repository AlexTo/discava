/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { RichTextView } from '@discava/common-shadcn/components/rich-text-view';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@discava/common-shadcn/components/ui/item';
import { Progress } from '@discava/common-shadcn/components/ui/progress';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { fileKind, formatFileSize } from '@discava/common-web-utils/file-size';
import type { ISubmission } from '@discava/core-api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { Alert } from '../../../../components/alert';
import { useCoreApi } from '../../../../hooks/useCoreApi';
import {
  awaitProgressRecalculation,
  errorCode,
  type PlayerItem,
} from './use-course-player';

// What a submission may be, as core-api allows it (LESSON_FILE_TYPES, which
// the portal can't import: it's server code): one file of at most 100 MB.
const ALLOWED_EXTENSIONS = [
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'txt',
  'csv',
  'md',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'zip',
];
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const LIMITS = `One file, up to 100 MB. Allowed: ${ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(', ')}`;

type AssignmentPlayerItem = Extract<PlayerItem, { type: 'assignment' }>;

// fetch() exposes no upload progress; XMLHttpRequest does. The headers are
// the ones the upload URL was signed with.
export const putFileWithProgress = (
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error('Failed to upload the file'));
    xhr.onerror = () => reject(new Error('Failed to upload the file'));
    xhr.send(file);
  });

// Why a file can't be attached, before anything is uploaded.
const refusalFor = (file: File): string | undefined => {
  const dot = file.name.lastIndexOf('.');
  const extension = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `${file.name} can't be attached (type)`;
  }
  if (file.size === 0) {
    return `${file.name} is empty`;
  }
  if (file.size > MAX_FILE_BYTES) {
    return `${file.name} is over 100 MB`;
  }
  return undefined;
};

const when = (iso: string) => new Date(iso).toLocaleString();

type Failure =
  | { kind: 'conflict' }
  | { kind: 'unavailable' }
  | { kind: 'failed'; message: string };

// An upload assignment (#102): its instructions, due date and limits, and a
// form to submit one file. core-api stores it with the submission and marks
// the item done in the same transaction.
export function AssignmentItem({
  item,
  done,
  readOnly,
  upload = putFileWithProgress,
}: {
  item: AssignmentPlayerItem;
  done: boolean;
  // The course is archived: nothing can be submitted.
  readOnly: boolean;
  // Stands in for the browser's upload in tests.
  upload?: typeof putFileWithProgress;
}) {
  const trpc = useCoreApi();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [refusal, setRefusal] = useState<string>();
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'submitting'>(
    'idle',
  );
  const [percent, setPercent] = useState(0);
  const [failure, setFailure] = useState<Failure>();
  const [submission, setSubmission] = useState<ISubmission>();
  const getUploadUrl = useMutation(trpc.assignment.uploadUrl.mutationOptions());
  const submit = useMutation(trpc.assignment.submit.mutationOptions());

  const { courseId, moduleId, lessonId, contentItemId } = item;
  const ref = { courseId, moduleId, lessonId, contentItemId };
  const busy = phase !== 'idle';
  const pastDue =
    item.dueAt !== undefined && Date.now() > Date.parse(item.dueAt);

  const choose = (chosen: File | undefined) => {
    setFailure(undefined);
    if (!chosen) {
      return;
    }
    const reason = refusalFor(chosen);
    setRefusal(reason);
    setFile(reason ? null : chosen);
  };

  const send = async () => {
    if (!file) {
      return;
    }
    setFailure(undefined);
    setPercent(0);
    try {
      setPhase('uploading');
      const target = await getUploadUrl.mutateAsync({
        ...ref,
        fileName: file.name,
        fileSize: file.size,
      });
      await upload(target.uploadUrl, target.headers, file, setPercent);
      setPhase('submitting');
      const result = await submit.mutateAsync({
        ...ref,
        objectKey: target.objectKey,
        fileName: file.name,
      });
      setSubmission(result);
      setFile(null);
      // The submission also completed the item; progress follows once
      // recalculation has run, which the player waits for (#237).
      void queryClient.invalidateQueries({
        queryKey: trpc.course.myItemCompletions.queryKey({ courseId }),
      });
      awaitProgressRecalculation(queryClient, trpc, courseId);
    } catch (error) {
      const code = errorCode(error);
      if (code === 'NOT_FOUND') {
        void queryClient.invalidateQueries({
          queryKey: trpc.course.view.queryKey({ courseId }),
        });
        setFailure({ kind: 'unavailable' });
      } else if (code === 'CONFLICT') {
        setFailure({ kind: 'conflict' });
      } else {
        setFailure({
          kind: 'failed',
          message:
            code === 'PRECONDITION_FAILED' || code === 'BAD_REQUEST'
              ? apiErrorMessage(error)
              : 'Something went wrong and your work was not submitted',
        });
      }
    } finally {
      setPhase('idle');
    }
  };

  return (
    <div className="space-y-4">
      <RichTextView value={item.body} className="prose-base" />
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        {item.dueAt ? (
          <div className="flex gap-1.5">
            <dt>Due</dt>
            <dd>{when(item.dueAt)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1.5">
          <dt>Maximum points</dt>
          <dd>{item.maxPoints}</dd>
        </div>
      </dl>
      <p className="text-sm text-muted-foreground">{LIMITS}</p>

      {/* Progress and errors are announced to assistive technology. */}
      <div role="status" aria-live="polite" className="space-y-3">
        {submission ? (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <CircleCheck className="size-4 text-emerald-600" aria-hidden />
              Submitted {when(submission.submittedAt)}
              <span className="text-muted-foreground">
                Version {submission.version}
              </span>
              {submission.late ? (
                <Badge variant="destructive">Late</Badge>
              ) : null}
            </p>
            <Item variant="outline">
              <ItemMedia variant="icon">
                <Paperclip />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{submission.file.fileName}</ItemTitle>
                <ItemDescription>
                  {fileKind(submission.file.fileName)} ·{' '}
                  {formatFileSize(submission.file.fileSize)}
                </ItemDescription>
              </ItemContent>
              <ItemActions />
            </Item>
          </div>
        ) : done ? (
          <p className="text-sm font-medium">
            You've submitted your work for this assignment.
          </p>
        ) : null}
        {phase === 'uploading' ? (
          <div className="space-y-1">
            <p className="text-sm">Uploading {file?.name}…</p>
            <Progress value={percent} aria-label={`Uploading, ${percent}%`} />
          </div>
        ) : null}
        {phase === 'submitting' ? (
          <p className="text-sm">Submitting your work…</p>
        ) : null}
      </div>

      {readOnly ? (
        <Alert header="This course is archived">
          Work can no longer be submitted.
        </Alert>
      ) : submission || done ? null : (
        <div className="space-y-3">
          {pastDue ? (
            <Alert header="This assignment is past due">
              This assignment is past due. Late work is accepted and marked
              late.
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label="Choose file"
              accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
              disabled={busy}
              onChange={(event) => {
                choose(event.target.files?.[0]);
                // So the same file can be chosen again.
                event.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
            {file ? (
              <span className="flex items-center gap-2 text-sm">
                <Paperclip className="size-4" aria-hidden />
                {file.name} ({formatFileSize(file.size)})
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setFile(null)}
                >
                  Remove
                </Button>
              </span>
            ) : null}
          </div>
          {refusal ? (
            <p role="alert" className="text-sm text-destructive">
              {refusal}
            </p>
          ) : null}

          {failure?.kind === 'conflict' ? (
            <Alert type="error" header="Not submitted">
              Your submission changed while you were sending it. Try again
            </Alert>
          ) : null}
          {failure?.kind === 'unavailable' ? (
            <Alert type="error" header="Not submitted">
              This assignment is no longer available.
            </Alert>
          ) : null}
          {failure?.kind === 'failed' ? (
            <Alert type="error" header="Not submitted">
              {failure.message}
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              disabled={!file || busy || failure?.kind === 'unavailable'}
              onClick={() => void send()}
            >
              {busy ? 'Submitting…' : failure ? 'Try again' : 'Submit'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
