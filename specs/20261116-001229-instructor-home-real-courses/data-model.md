# Data Model: Real Courses on the Instructor Home Page

No data is added or changed. The page reads two existing records through `course.listByInstructor`.

## Course (as listed)

| Field | Use on the home page |
|-------|----------------------|
| `courseId` | Link target to the editor |
| `title` | Card title |
| `status` | `draft` or `published` shown; `archived` filtered out |
| `imageKey` | Card image when present, placeholder otherwise |
| `description` | Optional card text |

## Instructor membership (`courseInstructor`)

Decides which courses the list returns, newest `courseUpdatedAt` first, through the existing `byInstructor` index. Not changed.

## Derived values

- Home course list = list items where `status !== 'archived'`, first 6.
- Summary "Courses" figure = number of non-archived items in the fetched list.
