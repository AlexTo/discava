/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { ErrorAlert } from '@discava/common-shadcn/components/error-alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@discava/common-shadcn/components/ui/alert-dialog';
import { Badge } from '@discava/common-shadcn/components/ui/badge';
import { Button } from '@discava/common-shadcn/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@discava/common-shadcn/components/ui/dialog';
import { Input } from '@discava/common-shadcn/components/ui/input';
import { Label } from '@discava/common-shadcn/components/ui/label';
import { apiErrorMessage } from '@discava/common-web-utils/api-errors';
import { CAPTION_LANGUAGES } from '@discava/common-web-utils/caption-languages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useInstructorApi } from '../../../../../../api';

// Native select styled like Input, as the language list is short and fixed.
const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none';

type Keys = {
  courseId: string;
  moduleId: string;
  lessonId: string;
  contentItemId: string;
};

// A caption track as the preview query lists it.
type Track = {
  trackId: string;
  language: string;
  label: string;
  isDefault: boolean;
  source: 'auto' | 'uploaded' | 'translated';
};

const SOURCE_BADGES: Record<Track['source'], string> = {
  auto: 'Automatic',
  uploaded: 'Uploaded',
  translated: 'Auto-translated',
};

const putCaptionFile = async (
  url: string,
  headers: Record<string, string>,
  file: File,
) => {
  const response = await fetch(url, { method: 'PUT', headers, body: file });
  if (!response.ok) {
    throw new Error('Failed to upload the caption file');
  }
};

// Manages a ready video's caption tracks: lists them, uploads a WebVTT file
// for a language (replacing that language's track) and removes tracks.
export function VideoCaptionsDialog({
  courseId,
  moduleId,
  lessonId,
  contentItemId,
  title,
  trigger,
}: Keys & { title: string; trigger: ReactNode }) {
  const keys: Keys = { courseId, moduleId, lessonId, contentItemId };
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<string>(CAPTION_LANGUAGES[0].tag);
  const [file, setFile] = useState<File>();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  const [isUploading, setIsUploading] = useState(false);
  const { course, contentItem } = useInstructorApi();
  const queryClient = useQueryClient();

  const videoUrlQuery = useQuery({
    ...contentItem.createVideoUrl.queryOptions(keys),
    enabled: open,
  });
  const tracks: Track[] = videoUrlQuery.data?.captions ?? [];
  const replacing = tracks.find((track) => track.language === language);

  const { mutateAsync: createUploadUrl } = useMutation(
    contentItem.captionUploadUrl.mutationOptions(),
  );
  const { mutateAsync: attachCaption } = useMutation(
    contentItem.attachCaption.mutationOptions(),
  );
  const {
    mutateAsync: removeCaption,
    isPending: isRemoving,
    reset: resetRemove,
  } = useMutation(contentItem.removeCaption.mutationOptions());

  // The track list comes from the preview query; the row's badge from the
  // course view.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: contentItem.createVideoUrl.queryKey(keys),
      }),
      queryClient.invalidateQueries({
        queryKey: course.view.queryKey({ courseId }),
      }),
    ]);

  const handleUpload = async () => {
    setError(undefined);
    if (!file || !/\.vtt$/i.test(file.name)) {
      setError('Choose a WebVTT file (.vtt).');
      return;
    }
    setIsUploading(true);
    try {
      const { uploadId, url, headers } = await createUploadUrl(keys);
      await putCaptionFile(url, headers, file);
      await attachCaption({ ...keys, uploadId, language });
      setFile(undefined);
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      await refresh();
    } catch (failure) {
      setError(apiErrorMessage(failure, "Couldn't upload the caption file"));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError(undefined);
          setFile(undefined);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Captions</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Captions for "{title}". A video can have up to 10 tracks, one per
            language, including auto-translated ones.
          </p>
        </DialogHeader>

        {error && (
          <ErrorAlert type="error" header="Couldn't change the captions">
            {error}
          </ErrorAlert>
        )}

        {videoUrlQuery.isError && (
          <ErrorAlert type="error" header="Couldn't load the captions">
            {apiErrorMessage(videoUrlQuery.error, 'Try again in a moment.')}
          </ErrorAlert>
        )}

        {videoUrlQuery.isSuccess && tracks.length === 0 && (
          <p className="text-sm text-muted-foreground">No captions yet.</p>
        )}

        {tracks.length > 0 && (
          <ul className="divide-y rounded-md border">
            {tracks.map((track) => (
              <li
                key={track.trackId}
                aria-label={track.label}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="flex-1 truncate text-sm font-medium">
                  {track.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {track.language}
                </span>
                <Badge variant="outline">{SOURCE_BADGES[track.source]}</Badge>
                {track.isDefault && <Badge>Default</Badge>}
                {track.source === 'translated' ? (
                  <span className="text-xs text-muted-foreground">
                    From the course's caption languages
                  </span>
                ) : (
                  <AlertDialog onOpenChange={(next) => !next && resetRemove()}>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${track.label}`}
                      >
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="sm:max-w-md">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove caption</AlertDialogTitle>
                        <AlertDialogDescription>
                          Students will no longer see the {track.label} captions
                          on "{title}".
                          {track.isDefault &&
                            ' The next track becomes the default.'}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={isRemoving}
                          onClick={async () => {
                            setError(undefined);
                            try {
                              await removeCaption({
                                ...keys,
                                trackId: track.trackId,
                              });
                              await refresh();
                            } catch (failure) {
                              setError(
                                apiErrorMessage(
                                  failure,
                                  "Couldn't remove the caption",
                                ),
                              );
                            }
                          }}
                        >
                          {isRemoving ? 'Removing…' : 'Remove caption'}
                        </Button>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="caption-language">Language</Label>
            <select
              id="caption-language"
              className={SELECT_CLASS}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            >
              {CAPTION_LANGUAGES.map(({ tag, label }) => (
                <option key={tag} value={tag}>
                  {label} ({tag})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="caption-file">Caption file (.vtt)</Label>
            <Input
              id="caption-file"
              ref={fileInput}
              type="file"
              accept=".vtt,text/vtt"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
            <p className="text-xs text-muted-foreground">
              WebVTT, up to 1 MB.
              {replacing && ` Uploading replaces the ${replacing.label} track.`}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            disabled={isUploading || !file}
            onClick={handleUpload}
          >
            {isUploading
              ? 'Uploading…'
              : replacing
                ? 'Replace caption'
                : 'Upload caption'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
