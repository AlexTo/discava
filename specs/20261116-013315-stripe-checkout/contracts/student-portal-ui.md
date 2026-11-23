# Contract: portal UI

## Student portal

**Course page** (`/learn/$courseId`, `enrolment-actions.tsx`), by state. All buttons are text only (no arrow icons).

| State | Shown |
|-------|-------|
| Not enrolled, course free | price line "Free"; **Enrol now** as today |
| Signed out, course priced | price line, e.g. "$20.00"; **Sign in to buy** (the return-to keeps the course) |
| Signed in, not enrolled, priced | price line; **Buy now** (calls `payment.checkout`, shows "Starting payment…", then sends the browser to `checkoutUrl`); an error alert with the API message |
| Signed in, not enrolled, priced, `payment.available` is false | price line and "Payments are unavailable right now. Please try again later."; no **Buy now** |
| `?checkout=success`, not yet enrolled | "Confirming your payment" with a progress indication; polls `course.myEnrolment` every 2 s for up to 60 s; on the enrolment appearing, the learner is taken to their lesson (see `specs/20261120-154551-first-lesson-start/contracts/student-portal-ui.md`) |
| `?checkout=success`, still not enrolled after 60 s | alert: "Your payment is still being confirmed. It is not lost: refresh in a minute." with a **Refresh** button; no **Buy now** |
| `?checkout=cancelled` | alert "Payment cancelled. You have not been charged." and **Buy now** |
| Enrolled or completed | as today |
| `dropped` (refunded) | "Your enrolment has ended." and, if the course is priced, **Buy now**; if it is free, **Enrol now**, which calls `course.enrol` and brings the enrolment back with its progress (core-api-payment.md) |

The price comes from `course.publicView`; the API, not the page, decides what is charged. An address with `?checkout=success` and no payment shows the waiting state and then the 60 s message, and grants nothing.

**Catalogue cards** (the `/search` results and the home page's course cards) show the price or "Free" under the title, formatted with `formatPrice`.

**Errors**: `enrolErrorMessage` maps `PRECONDITION_FAILED` to "This course must be purchased" and offers **Buy now**.

## Instructor portal

On the course's settings (beside the certificates switch, `course-price-form.tsx`): a "Price" field and a currency select, with **Save price**. When the API refuses because payments aren't connected, the form shows its message ("Payments aren't set up yet; ask an administrator") and keeps the old price; setting 0 (free) is never refused. The field takes a typed amount ("19.99"), parsed with `parsePriceInput`; "0" means free. It shows the rule on error (minimum 1.00, maximum 10,000.00), a note "Students who are already enrolled keep their access; the new price applies to new purchases", and the current price on load. A failing call shows the API message and restores the previous value. The form is available for draft, published and archived courses.

On a refusal with `PRECONDITION_FAILED` "Payments are unavailable right now" (the connection changed after the page loaded), the page shows the same unavailable message.

## Tests

Student portal, with the `renderWithCoreApi`-style helper: every row of the table above; **Buy now** calls `payment.checkout` with the course ID and sends the browser to the returned URL; polling stops on the enrolment appearing and at 60 s (fake timers); the `?checkout=success` marker alone never shows the enrolled state; catalogue cards show the price; no arrow icons in any button. Instructor portal, with `renderWithInstructorApi`: shows the current price; typed "19.99" sends 1999; "abc", "0.5" and "10001" show the rule and send nothing; a failing call restores the field.

## Amendment 2026-11-19: learner refunds and leaving a course

**Course page** (`enrolment-actions.tsx`), added states. All buttons are text only (no arrow icons). Dates use the viewer's locale.

| State | Shown |
|-------|-------|
| Course priced, any visitor not enrolled | under the price line: "14-day refund if you haven't completed the course." (the number from `course.publicView`) |
| Enrolled, paid for, `canRequestRefund` | "You can request a refund until <date>." and **Request a refund**. The dialog says the amount, that access to the course ends and progress is kept, with **Request refund** and **Cancel** |
| Enrolled, paid for, refund requested | "Refund requested on <date>. Your access ends when it is confirmed." No button. The page polls `course.myEnrolment` as the `?checkout=success` state does and moves to the ended state by itself |
| Enrolled, paid for, `refundBlockedBy: window-ended` | "The refund period for this course ended on <date>." No button |
| Completed, paid for, within the 14 days | "A course can't be refunded after you have completed it." No button |
| Enrolled, paid for, `refundBlockedBy: progress-limit` (amendment 2026-11-23) | "Refunds end once you've completed half of the course." No button |
| Enrolled, paid for, `refundBlockedBy: refunded-before` (amendment 2026-11-23) | "You were refunded for this course before, so this purchase can't be refunded." No button |
| `dropped` or not enrolled, `refundedBefore`, course priced (amendment 2026-11-23) | beside **Buy now**: "You were refunded for this course before. If you buy it again, it can't be refunded." |
| Enrolled, paid for, `refundBlockedBy: other-account` | "This purchase can't be refunded here right now." No button |
| Enrolled or completed, not paid for | **Leave course**. The dialog says the enrolment ends and progress is kept; if the course now has a price it adds "This course now has a price. To come back you would need to buy it." **Leave course** and **Cancel** |
| `dropped`, with a refunded order (`payment.myOrder` is `refunded`) | "Your enrolment has ended. Refunded on <date>." and **Buy now** or, if the course is free, **Enrol now** |
| `dropped`, otherwise (the student left) | "Your enrolment has ended." and **Enrol now** or, if the course is priced, **Buy now** |

Amendment 2026-11-23: the terms line under the price becomes "14-day refund while you've completed less than half of the course. One refund per course.", built by `refundTerms(days, percent)` in `@discava/common-web-utils/price` from `course.publicView`'s `refundWindowDays` and `refundProgressLimitPercent`.

**Request a refund** and **Leave course** are never shown together: the first needs `paidFor`, the second its absence. Neither is shown on an ended enrolment. A refusal from the API is shown as an error alert with the API's message.

**My Learning** is unchanged: an ended enrolment already leaves it.

### Tests

As listed in tasks T098 and T104.
