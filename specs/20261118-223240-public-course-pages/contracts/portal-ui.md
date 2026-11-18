# Contract: portal UI

Buttons have text labels only (no arrow icons). Every change a user sees is captured with `screenshot()` in its e2e scenario (constitution VIII).

## Student portal

### Course landing page: `routes/learn/$courseId/index.tsx` → `-components/course-page.tsx`

The page keeps the existing structure (header, facts card, sticky section nav, About, Modules, Reviews) and changes the following:

- **Header media**: when `preview` is present, the image is replaced by the shared `HlsVideo` player (`common-shadcn`). It shows a poster (the course image) and a "Preview this course" label, and loads `course.previewVideoUrl` only when the visitor presses play. Without a preview, it shows the course image as today.
- **Facts card**: gains level, language and estimated hours when set, beside the existing module and lesson counts.
- **Sections**:
  - a new **"What you'll learn"** section, a two-column check list placed first;
  - **"Requirements"**, a bullet list placed after About;
  - **"Instructors"**, one card each (photo or initials, display name, headline, a "View profile" link to `/instructors/$handle`) placed before Reviews.

  Empty sections are left out, and the section nav lists only the sections shown.
- **Not found**: unchanged ("Course not found"), also for archived courses.
- **Seeded data**: `main.tsx` calls `seedFromPageData(queryClient)` (in `src/lib/page-data.ts`) before the first render. It reads `#discava-page-data`, calls `setQueryData` for the matching tRPC query keys, and removes the element.

### Instructor profile: new route `routes/instructors/$handle.tsx`

- It shows the photo, display name, headline and bio (paragraphs), then "Courses by <display name>" as the same course cards the catalogue uses (image, title, rating).
- A `NOT_FOUND` response shows "Instructor not found" with a "Browse courses" button.
- The document title is set to the display name.

## Instructor portal

### Course landing page settings: `routes/_authenticated/my-courses_/$courseId/` (course settings area, beside catalogue fields)

- A **"Landing page"** card has:
  - an editable list for outcomes and another for requirements: add, remove, and reorder with "Move up" and "Move down" text buttons; character counter at 160; at most 10 items;
  - a "Preview video" select listing the course's video items as "Module › Lesson › Item", with a "None" option and a status note when the chosen item is not currently shown (hidden, archived or not ready);
  - Save and Cancel.
- A **"Landing page checklist"** shows five lines, each ticked or not: outcomes, requirements, preview, course image, your profile (a profile with a headline and photo). Each links to where it is fixed. It is informational only and never disables Publish.
- A **"View public page"** link opens `<student portal>/learn/<courseId>` in a new tab when the course is published.

### Profile: new route `routes/_authenticated/profile.tsx` (linked from the account menu as "Public profile")

- It has fields for display name, handle (with a live preview of the address `/instructors/<handle>`), headline and bio, a photo with the existing crop dialog at 1:1, and Save.
- The conflict messages from `profile.update` show inline on the field they concern.
- A status line reads "Your profile is public" with a link, or "Your profile becomes public when one of your courses is published".
