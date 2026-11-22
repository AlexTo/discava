/**
 * Copyright Discava Contributors. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PostCard } from './post-card';

const shown = {
  state: 'shown' as const,
  authorName: 'Ada L.',
  body: 'How do I start?',
  createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  voteCount: 2,
};

describe('PostCard', () => {
  it('shows the author, time, text and upvotes', () => {
    render(<PostCard post={shown} action="asked" />);
    expect(screen.getByText('Ada L.')).toBeInTheDocument();
    expect(screen.getByText('asked 3 days ago')).toBeInTheDocument();
    expect(screen.getByText('How do I start?')).toBeInTheDocument();
    expect(screen.getByText('2 upvotes')).toBeInTheDocument();
    expect(screen.queryByText('Instructor')).toBeNull();
  });

  it('shows the Instructor badge only for instructors', () => {
    render(<PostCard post={{ ...shown, authorIsInstructor: true }} />);
    expect(screen.getByText('Instructor')).toBeInTheDocument();
  });

  it('labels an answer to the course prompt, beside the title', () => {
    render(
      <PostCard
        post={{ ...shown, title: 'Hello', promptAnswer: true }}
        showTitle
      />,
    );
    expect(screen.getByText('Answer to the course prompt')).toBeInTheDocument();
  });

  it('has no prompt label without the flag', () => {
    render(<PostCard post={{ ...shown, title: 'Hello' }} showTitle />);
    expect(screen.queryByText('Answer to the course prompt')).toBeNull();
  });

  it('shows a markup title as text', () => {
    render(<PostCard post={{ ...shown, title: '<i>Why?</i>' }} showTitle />);
    expect(screen.getByText('<i>Why?</i>')).toBeInTheDocument();
  });

  it.each([
    ['hidden', 'This post was hidden by an instructor.'],
    ['deleted', 'This post was deleted.'],
  ] as const)('shows only a placeholder for a %s post', (state, message) => {
    const { container } = render(
      <PostCard post={{ ...shown, state, title: 'Secret' }} showTitle>
        <button type="button">Upvote</button>
      </PostCard>,
    );
    expect(container.textContent).toBe(message);
  });
});
