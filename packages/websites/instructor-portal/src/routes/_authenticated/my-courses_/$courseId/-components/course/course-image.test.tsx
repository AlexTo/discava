/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_MEDIA_URL,
  renderWithInstructorApi,
} from '../../../../../../test/render-with-instructor-api';
import { CourseImage } from './course-image';

const AREA = { x: 10, y: 20, width: 1600, height: 900 };
const CROPPED = new Blob(['x'.repeat(1234)], { type: 'image/jpeg' });

// jsdom can't decode or draw images: the cropper reports a crop as soon as it
// shows, and cropping returns a fixed JPEG.
vi.mock('react-easy-crop', () => ({
  default: ({
    onCropComplete,
  }: {
    onCropComplete: (area: unknown, pixels: unknown) => void;
  }) => {
    useEffect(() => onCropComplete(AREA, AREA), [onCropComplete]);
    return <div data-testid="cropper" />;
  },
}));
const cropToJpeg = vi.hoisted(() => vi.fn());
vi.mock('./crop-to-jpeg', () => ({ cropToJpeg }));

const COURSE_ID = 'course-1';
const OLD_KEY = 'courses/course-1/image/old.jpg';
const NEW_KEY = 'courses/course-1/image/new.jpg';
const course = {
  courseId: COURSE_ID,
  title: 'Intro to DynamoDB',
  status: 'published',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

// The PUT straight to S3, which goes through the global fetch, unlike the
// API's calls.
const s3Put = vi.fn();

beforeEach(() => {
  cropToJpeg.mockResolvedValue(CROPPED);
  s3Put.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', s3Put);
  URL.createObjectURL = vi.fn(() => 'blob:picked');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const pickImage = async (
  user: ReturnType<typeof renderWithInstructorApi>['user'],
) => {
  await user.upload(
    screen.getByLabelText('Course image file'),
    new File(['png'], 'photo.png', { type: 'image/png' }),
  );
  await screen.findByTestId('cropper');
};

describe('CourseImage', () => {
  it('shows the course’s image, and no way to change it while archived', () => {
    renderWithInstructorApi(
      <CourseImage courseId={COURSE_ID} imageKey={OLD_KEY} readOnly />,
    );

    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      `${PUBLIC_MEDIA_URL}${OLD_KEY}`,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uploads the cropped image as signed, then saves it on the course', async () => {
    const { calls, user } = renderWithInstructorApi(
      <CourseImage courseId={COURSE_ID} readOnly={false} />,
      {
        handlers: {
          'course.createImageUploadUrl': () => ({
            uploadUrl: 'https://bucket.s3.test/upload',
            imageKey: NEW_KEY,
            headers: {
              'Content-Type': 'image/jpeg',
              'x-amz-tagging': 'lifecycle=unattached',
            },
          }),
          'course.updateImage': () => ({ ...course, imageKey: NEW_KEY }),
        },
      },
    );

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    await pickImage(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(cropToJpeg).toHaveBeenCalledWith('blob:picked', AREA);
    expect(s3Put).toHaveBeenCalledWith('https://bucket.s3.test/upload', {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        'x-amz-tagging': 'lifecycle=unattached',
      },
      body: CROPPED,
    });
    expect(calls).toEqual([
      {
        path: 'course.createImageUploadUrl',
        input: { courseId: COURSE_ID, contentLength: 1234 },
      },
      {
        path: 'course.updateImage',
        input: { courseId: COURSE_ID, imageKey: NEW_KEY },
      },
    ]);
  });

  it('doesn’t save an image that didn’t upload', async () => {
    s3Put.mockResolvedValue(new Response(null, { status: 403 }));
    const { calls, user } = renderWithInstructorApi(
      <CourseImage courseId={COURSE_ID} readOnly={false} />,
      {
        handlers: {
          'course.createImageUploadUrl': () => ({
            uploadUrl: 'https://bucket.s3.test/upload',
            imageKey: NEW_KEY,
            headers: {},
          }),
        },
      },
    );

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    await pickImage(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't upload the image",
    );
    expect(calls.map(({ path }) => path)).not.toContain('course.updateImage');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('removes the image', async () => {
    const { calls, user } = renderWithInstructorApi(
      <CourseImage courseId={COURSE_ID} imageKey={OLD_KEY} readOnly={false} />,
      { handlers: { 'course.updateImage': () => course } },
    );

    await user.click(screen.getByRole('button', { name: 'Change image' }));
    await user.click(screen.getByRole('button', { name: 'Remove image' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(calls).toEqual([
      {
        path: 'course.updateImage',
        input: { courseId: COURSE_ID, imageKey: null },
      },
    ]);
  });
});
