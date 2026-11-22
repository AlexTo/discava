# Contract: page titles

`usePageTitle(...parts)` comes from the student-portal feature (`@discava/common-shadcn/hooks/use-page-title`). It drops empty parts, appends "Discava", and joins the parts with " · ".

Each instructor-portal route calls it from its first render. Where a part comes from a request, that part is undefined until the request answers, so the title falls back to the "while loading or on error" column.

| Route | Loaded | While loading or on error |
|-------|--------|---------------------------|
| `/signin` | `Signing in · Discava` | same |
| any route, signed in without the instructor group | `Instructors only · Discava` | same |
| `/` | `Home · Discava` | same |
| `/dashboard` | `Dashboard · Discava` | same |
| `/dashboard/$courseId` | `<course title> · Dashboard · Discava` | `Course analytics · Discava` |
| `/my-courses` | `My Courses · Discava` | same |
| `/my-courses/$courseId` | `<course title> · My Courses · Discava` | `Course · Discava` |
| `/my-courses/$courseId/questions` | `Questions · <course title> · Discava` | `Questions · Discava` |
| `/my-courses/$courseId/reviews` | `Reviews · <course title> · Discava` | `Reviews · Discava` |
| `/my-courses/$courseId/assignments/$contentItemId/submissions` | `<assignment title> · Submissions · Discava` | `Submissions · Discava` |
| `/my-courses/$courseId/assignments/$contentItemId/submissions/$userId` | `<student name> · <assignment title> · Discava` | `Submission · Discava` |
| `/earnings` | `Earnings · Discava` | same |
| `/profile` | `Profile · Discava` | same |
| `/settings/notifications` | `Notification settings · Discava` | same |
| an address with no page | `Page not found · Discava` | same |

Rules:

- A title is plain text, the title or name as stored. The browser shortens it.
- No route writes `document.title` any other way.
- The main heading (`h1`) of each page names the same thing as the first part of its title. While loading or on error it shows the fallback: "Course analytics", "Course", "Submission", "Profile".
