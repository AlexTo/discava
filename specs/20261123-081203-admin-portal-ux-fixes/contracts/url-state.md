# Contract: views kept in the address

Two routes gain `validateSearch`. A parameter that is absent means the default. An invalid value (empty, or over 100 characters) is dropped, and the address is corrected with `replace`; T037 and T038 test it.

## `/reviews`

| Param | Values | Default | Written by |
|-------|--------|---------|------------|
| `course` | a course id, at most 100 characters | none (no course chosen) | the course picker (push); choosing "Choose a course" removes it |

- With `course` set, the screen requests that course's reviews with `review.list`, as choosing it in the picker does today.
- If the id isn't among the courses loaded so far, the picker shows one extra option, "The course from the link", selected, until "More courses" loads the course.
- A course with no reviews shows "No reviews yet"; an id the API refuses shows the failed load's message, with Try again.

## `/certificates`

| Param | Values | Default | Written by |
|-------|--------|---------|------------|
| `id` | a certificate ID, trimmed, at most 100 characters | none (nothing looked up) | Look up (push) |

- With `id` set, the screen requests `certificate.get` for it, as Look up does today, and the field shows the id.
- Back and Forward update the field and the result together.
- An id that matches no certificate shows the not-found message (research R-11), with the id left in the field to correct.
