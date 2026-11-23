/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import { PendingButton } from '@discava/common-shadcn/components/pending-button';
import { StatusMessage } from '@discava/common-shadcn/components/status-message';
import { Button } from '@discava/common-shadcn/components/ui/button';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { useInstructorApi } from '../../../../../../api';
import { RichTextEditor } from '../rich-text-editor';

const TITLE_MAX = 120;

export interface EditableAnnouncement {
  announcementId: string;
  title: string;
  body: string;
  version: number;
}

/**
 * Posts a new announcement, or with `announcement` edits one. The id of a new
 * post is minted when the form opens and kept across failed attempts, so a
 * retry (or a double click) is the same post; a successful post mints the next.
 */
export function AnnouncementForm({
  courseId,
  announcement,
  onDone,
}: {
  courseId: string;
  /** Set to edit this announcement; omitted to post a new one. */
  announcement?: EditableAnnouncement;
  /** Called after a save or a reload, and by Cancel, in edit mode. */
  onDone?: () => void;
}) {
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body);
  const [announcementId, setAnnouncementId] = useState(() => uuidv7());
  // Remounts the editor, which reads its value only once, after a post.
  const [editorKey, setEditorKey] = useState(0);
  const [conflict, setConflict] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(announcement);

  // Edit opens on its title field.
  useEffect(() => {
    if (editing) {
      titleRef.current?.focus();
    }
  }, [editing]);
  const trpc = useInstructorApi();
  const queryClient = useQueryClient();
  const create = useMutation(trpc.announcement.create.mutationOptions());
  const update = useMutation(trpc.announcement.update.mutationOptions());
  const mutation = announcement ? update : create;

  const canSave = title.trim().length > 0 && Boolean(body);

  const refreshList = () =>
    queryClient.invalidateQueries(trpc.announcement.list.pathFilter());

  const handleSave = async () => {
    if (!body || mutation.isPending) {
      return;
    }
    setConflict(false);
    try {
      if (announcement) {
        await update.mutateAsync({
          courseId,
          announcementId: announcement.announcementId,
          version: announcement.version,
          title: title.trim(),
          body,
        });
      } else {
        await create.mutateAsync({
          courseId,
          announcementId,
          title: title.trim(),
          body,
        });
        setTitle('');
        setBody(undefined);
        setEditorKey((key) => key + 1);
        setAnnouncementId(uuidv7());
        create.reset();
        setStatus('Announcement posted');
        titleRef.current?.focus();
      }
    } catch (error) {
      const code = (error as { data?: { code?: string } }).data?.code;
      setConflict(code === 'CONFLICT' && Boolean(announcement));
      return;
    }
    await refreshList();
    onDone?.();
  };

  const idPrefix = announcement ? `edit-${announcement.announcementId}` : 'new';

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      {mutation.isError && (
        <ErrorAlert
          type="error"
          header={
            announcement
              ? "Couldn't save the changes"
              : "Couldn't post the announcement"
          }
        >
          <div className="space-y-2">
            <p>{apiErrorMessage(mutation.error)}</p>
            {conflict && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  await refreshList();
                  onDone?.();
                }}
              >
                Reload
              </Button>
            )}
          </div>
        </ErrorAlert>
      )}

      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <Label htmlFor={`${idPrefix}-announcement-title`}>Title</Label>
          <span
            className="text-xs text-muted-foreground"
            aria-live="polite"
          >{`${title.length}/${TITLE_MAX}`}</span>
        </div>
        <Input
          ref={titleRef}
          id={`${idPrefix}-announcement-title`}
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="space-y-2">
        <RichTextEditor
          key={editorKey}
          value={body}
          onChange={setBody}
          ariaLabel="Announcement text"
        />
        {!announcement && (
          <p className="text-xs text-muted-foreground">
            Posting notifies the students enrolled in this course.
          </p>
        )}
      </div>

      {!announcement && <StatusMessage message={status} />}

      <div className="flex justify-end gap-2">
        {announcement && (
          <Button type="button" variant="outline" onClick={() => onDone?.()}>
            Cancel
          </Button>
        )}
        <PendingButton
          type="submit"
          disabled={!canSave}
          pending={mutation.isPending}
          pendingLabel={announcement ? 'Saving…' : 'Posting…'}
        >
          {announcement ? 'Save changes' : 'Post announcement'}
        </PendingButton>
      </div>
    </form>
  );
}
