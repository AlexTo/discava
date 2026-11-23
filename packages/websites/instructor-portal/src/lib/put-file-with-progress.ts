/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// fetch() exposes no upload progress; XMLHttpRequest does via
// xhr.upload.onprogress, hence the lower-level API here instead of fetch. The
// headers are the ones the upload URL was signed with.
export const putFileWithProgress = (
  uploadUrl: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
  failureMessage: string,
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
        : reject(new Error(failureMessage));
    // A network fault is a TypeError, as fetch's is, so apiErrorMessage says
    // "Couldn't reach Discava…" rather than the technical failure.
    xhr.onerror = () =>
      reject(new TypeError(failureMessage, { cause: new Error('XHR error') }));
    xhr.send(file);
  });
