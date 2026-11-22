/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeTree } from '../../routeTree.gen';
import {
  ApiError,
  type Handler,
  renderWithCoreApi,
} from '../../test/render-with-core-api';

const AT = '2026-10-01T00:00:00.000Z';

const enrolment = (
  courseId: string,
  overrides: Record<string, unknown> = {},
) => ({
  courseId,
  title: `Course ${courseId}`,
  courseStatus: 'published',
  status: 'active',
  progressPercent: 40,
  enrolledAt: AT,
  nextLesson: {
    lessonId: `${courseId}-lesson`,
    title: `Next in ${courseId}`,
    moduleTitle: 'Vectors',
    moduleIndex: 1,
  },
  newItemCount: 0,
  ...overrides,
});

const catalogueCourse = (courseId: string) => ({
  courseId,
  title: `Catalogue ${courseId}`,
  status: 'published',
  createdAt: AT,
  updatedAt: AT,
});

// Most recently active first, as core-api returns them.
const enrolments = [
  enrolment('c1'),
  enrolment('c2', { progressPercent: 10 }),
  enrolment('c3', {
    status: 'completed',
    progressPercent: 80,
    completedAt: AT,
    nextLesson: null,
    newItemCount: 1,
  }),
];

const open = (path: string, handlers: Record<string, Handler> = {}) =>
  renderWithCoreApi(null, {
    routeTree,
    path,
    signedIn: true,
    handlers: {
      'course.myEnrolments': () => ({ items: enrolments }),
      'certificate.myCertificates': () => [],
      'course.publicList': () => ({
        items: ['c1', 'c4', 'c5'].map(catalogueCourse),
        cursor: null,
      }),
      ...handlers,
    },
  });

describe('the signed-in home', () => {
  it('continues the course the student was last active in', async () => {
    open('/');

    expect(
      await screen.findByRole('heading', { name: /^Welcome back,/ }),
    ).toBeInTheDocument();
    const hero = screen.getByRole('heading', { name: 'Course c1' })
      .parentElement as HTMLElement;
    expect(
      within(hero).getByText('Next in c1', { exact: false }),
    ).toBeInTheDocument();
    expect(
      within(hero).getByRole('link', { name: 'Continue: Course c1' }),
    ).toHaveAttribute('href', '/learn/c1/lesson/c1-lesson');
  });

  it('lists the student’s other courses in progress', async () => {
    open('/');

    const section = await screen.findByRole('region', {
      name: 'Your other courses',
    });
    expect(within(section).getByText('Course c2')).toBeInTheDocument();
    // Completed courses are in My Learning, not here.
    expect(within(section).queryByText('Course c3')).toBeNull();
    expect(
      within(section).getByRole('link', { name: 'See all in My Learning' }),
    ).toHaveAttribute('href', '/my-learning');
  });

  it('suggests courses the student isn’t enrolled in', async () => {
    open('/');

    const section = await screen.findByRole('region', {
      name: 'Courses to start',
    });
    expect(
      await within(section).findByText('Catalogue c4'),
    ).toBeInTheDocument();
    expect(within(section).queryByText('Catalogue c1')).toBeNull();
    // One link per card, named by its title.
    const links = within(section).getAllByRole('link');
    expect(links).toHaveLength(
      section.querySelectorAll('[data-slot="card"]').length,
    );
    expect(links[0]).toHaveAccessibleName(/^Catalogue c/);
  });

  it('welcomes a student with no courses yet', async () => {
    open('/', { 'course.myEnrolments': () => ({ items: [] }) });

    expect(
      await screen.findByRole('heading', { name: /^Welcome, /i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Browse courses/ }),
    ).toBeInTheDocument();
  });
});

describe('/my-learning', () => {
  it('splits courses into in progress and completed', async () => {
    const { user } = open('/my-learning');

    expect(
      await screen.findByRole('tab', { name: 'In progress (2)' }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Course c1')).toBeInTheDocument();
    expect(screen.getByText('Course c2')).toBeInTheDocument();
    expect(screen.queryByText('Course c3')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Completed (1)' }));

    expect(await screen.findByText('Course c3')).toBeInTheDocument();
    expect(screen.getByText('· 1 new item')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'See what’s new: Course c3' }),
    ).toHaveAttribute('href', '/learn/c3/home');
  });

  it('shows each course’s next lesson', async () => {
    open('/my-learning');

    expect(
      await screen.findByText('Next in c2', { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Continue: Course c2' }),
    ).toHaveAttribute('href', '/learn/c2/lesson/c2-lesson');
  });

  it('is linked from the top bar', async () => {
    open('/');

    expect(
      await screen.findByRole('link', { name: 'My Learning' }),
    ).toHaveAttribute('href', '/my-learning');
  });
});

describe('/my-learning certificates', () => {
  const certificates = [
    {
      certificateId: 'ABCD-EFGH-JKLM',
      courseId: 'c3',
      courseTitle: 'Course c3',
      learnerName: 'Ada Lovelace',
      completedAt: AT,
    },
    // A certificate for a course that isn't among the completed ones.
    {
      certificateId: 'NNNN-PPPP-QQQQ',
      courseId: 'c1',
      courseTitle: 'Course c1',
      learnerName: 'Ada Lovelace',
      completedAt: AT,
    },
  ];
  const withCertificates = {
    'certificate.myCertificates': () => certificates,
  };

  const openCompleted = async (handlers: Record<string, Handler> = {}) => {
    const result = open('/my-learning', { ...withCertificates, ...handlers });
    await result.user.click(
      await screen.findByRole('tab', { name: 'Completed (1)' }),
    );
    await screen.findByText('Course c3');
    return result;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('appears only for courses with a certificate', async () => {
    const { user } = await openCompleted();

    const group = await screen.findByRole('group', { name: 'Certificate' });
    expect(screen.getAllByRole('group', { name: 'Certificate' })).toHaveLength(
      1,
    );
    expect(within(group).getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/certificates/ABCD-EFGH-JKLM',
    );
    expect(within(group).getByRole('link', { name: 'View' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('links to LinkedIn’s form with the certificate’s values', async () => {
    await openCompleted();

    const link = await screen.findByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://www.linkedin.com/profile/add',
    );
    expect(url.searchParams.get('startTask')).toBe('CERTIFICATION_NAME');
    expect(url.searchParams.get('name')).toBe('Course c3');
    expect(url.searchParams.get('certId')).toBe('ABCD-EFGH-JKLM');
    expect(url.searchParams.get('certUrl')).toBe(
      `${window.location.origin}/certificates/ABCD-EFGH-JKLM`,
    );
  });

  it('records the use when the link is clicked', async () => {
    const { user, calls } = await openCompleted({
      'certificate.recordLinkedInClick': () => ({}),
    });
    const link = await screen.findByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    // jsdom can't open LinkedIn; the click's navigation isn't what's tested.
    link.addEventListener('click', (event) => event.preventDefault());

    await user.click(link);

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: 'certificate.recordLinkedInClick',
        input: { certificateId: 'ABCD-EFGH-JKLM', source: 'my-learning' },
      }),
    );
  });

  it('shows no alert when recording the use fails', async () => {
    const { user, calls } = await openCompleted({
      'certificate.recordLinkedInClick': () => {
        throw new Error('boom');
      },
    });
    const link = await screen.findByRole('link', {
      name: 'Add to LinkedIn profile',
    });
    link.addEventListener('click', (event) => event.preventDefault());

    await user.click(link);

    await waitFor(() =>
      expect(calls.map((c) => c.path)).toContain(
        'certificate.recordLinkedInClick',
      ),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is absent for a completed course without one', async () => {
    await openCompleted({ 'certificate.myCertificates': () => [] });

    expect(screen.queryByRole('group', { name: 'Certificate' })).toBeNull();
    expect(
      screen.queryByRole('link', { name: 'Add to LinkedIn profile' }),
    ).toBeNull();
  });

  it('reads the student’s certificates once', async () => {
    const { calls } = await openCompleted();
    await screen.findByRole('group', { name: 'Certificate' });

    expect(
      calls.filter((c) => c.path === 'certificate.myCertificates'),
    ).toHaveLength(1);
  });

  it('copies the certificate’s link', async () => {
    const { user } = await openCompleted();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue();

    await user.click(await screen.findByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/certificates/ABCD-EFGH-JKLM`,
    );
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('downloads the PDF', async () => {
    const createObjectURL = vi.fn(() => 'blob:certificate');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL }),
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('certificate-ABCD-EFGH-JKLM.pdf');
      });
    const { user, calls } = await openCompleted({
      'certificate.pdf': () => ({
        fileName: 'certificate-ABCD-EFGH-JKLM.pdf',
        contentBase64: btoa('%PDF-1.7'),
      }),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Download PDF' }),
    );

    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(calls).toContainEqual({
      path: 'certificate.pdf',
      input: { courseId: 'c3' },
    });
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('application/pdf');
    expect(await blob.text()).toBe('%PDF-1.7');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
  });

  it('says it is preparing while the PDF is drawn', async () => {
    const { user } = await openCompleted({
      'certificate.pdf': () => new Promise(() => {}),
    });

    await user.click(
      await screen.findByRole('button', { name: 'Download PDF' }),
    );

    expect(
      await screen.findByRole('button', { name: 'Preparing…' }),
    ).toBeDisabled();
  });

  it('shows an error, and lets the student retry, when the download fails', async () => {
    const createObjectURL = vi.fn(() => 'blob:certificate');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let fail = true;
    const { user } = await openCompleted({
      'certificate.pdf': () => {
        if (fail) {
          throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
        }
        return { fileName: 'c.pdf', contentBase64: btoa('x') };
      },
    });

    await user.click(
      await screen.findByRole('button', { name: 'Download PDF' }),
    );
    expect(
      await screen.findByText("Couldn't download your certificate", {
        exact: false,
      }),
    ).toBeInTheDocument();
    expect(createObjectURL).not.toHaveBeenCalled();

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leaves the rest of the page working when the certificates can’t be read', async () => {
    await openCompleted({
      'certificate.myCertificates': () => {
        throw new ApiError('INTERNAL_SERVER_ERROR', 'boom');
      },
    });

    expect(screen.getByText('Course c3')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Certificate' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
