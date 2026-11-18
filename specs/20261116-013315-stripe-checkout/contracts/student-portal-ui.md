# Contract: portal UI

## Student portal

**Course page** (`/learn/$courseId`, `enrolment-actions.tsx`), by state. All buttons are text only (no arrow icons).

| State | Shown |
|-------|-------|
| Not enrolled, course free | price line "Free"; **Enrol now** as today |
| Signed out, course priced | price line, e.g. "$20.00"; **Sign in to buy** (the return-to keeps the course) |
| Signed in, not enrolled, priced | price line; **Buy now** (calls `payment.checkout`, shows "Starting payment…", then sends the browser to `checkoutUrl`); an error alert with the API message |
| Signed in, not enrolled, priced, `payment.available` is false | price line and "Payments are unavailable right now. Please try again later."; no **Buy now** |
| `?checkout=success`, not yet enrolled | "Confirming your payment" with a progress indication; polls `course.myEnrolment` every 2 s for up to 60 s; on the enrolment appearing, the enrolled state and the usual enrolled dialog |
| `?checkout=success`, still not enrolled after 60 s | alert: "Your payment is still being confirmed. It is not lost: refresh in a minute." with a **Refresh** button; no **Buy now** |
| `?checkout=cancelled` | alert "Payment cancelled. You have not been charged." and **Buy now** |
| Enrolled or completed | as today |
| `dropped` (refunded) | "Your enrolment has ended." and, if the course is priced, **Buy now**; for a free course the existing message |

The price comes from `course.publicView`; the API, not the page, decides what is charged. An address with `?checkout=success` and no payment shows the waiting state and then the 60 s message, and grants nothing.

**Catalogue cards** (the `/search` results and the home page's course cards) show the price or "Free" under the title, formatted with `formatPrice`.

**Errors**: `enrolErrorMessage` maps `PRECONDITION_FAILED` to "This course must be purchased" and offers **Buy now**.

## Instructor portal

On the course's settings (beside the certificates switch, `course-price-form.tsx`): a "Price" field and a currency select, with **Save price**. When the API refuses because payments aren't connected, the form shows its message ("Payments aren't set up yet; ask an administrator") and keeps the old price; setting 0 (free) is never refused. The field takes a typed amount ("19.99"), parsed with `parsePriceInput`; "0" means free. It shows the rule on error (minimum 1.00, maximum 10,000.00), a note "Students who are already enrolled keep their access; the new price applies to new purchases", and the current price on load. A failing call shows the API message and restores the previous value. The form is available for draft, published and archived courses.

On a refusal with `PRECONDITION_FAILED` "Payments are unavailable right now" (the connection changed after the page loaded), the page shows the same unavailable message.

## Tests

Student portal, with the `renderWithCoreApi`-style helper: every row of the table above; **Buy now** calls `payment.checkout` with the course ID and sends the browser to the returned URL; polling stops on the enrolment appearing and at 60 s (fake timers); the `?checkout=success` marker alone never shows the enrolled state; catalogue cards show the price; no arrow icons in any button. Instructor portal, with `renderWithInstructorApi`: shows the current price; typed "19.99" sends 1999; "abc", "0.5" and "10001" show the rule and send nothing; a failing call restores the field.
