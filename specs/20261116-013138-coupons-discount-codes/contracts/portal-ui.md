# Contract: portal UI

All buttons carry text labels only, no arrow icons.

## Instructor portal: Coupons screen

Route `/my-courses/$courseId/coupons`, linked from the course's tabs or actions beside the existing curriculum and settings entry points (find them first).

- **List**: one row per code: code, "20% off" or "$5.00 off", expiry date ("Ends 30 Nov, UTC") or "No expiry", "3 of 10 used" or "3 used", a status badge (Active, Disabled, Expired, Used up), and the actions Disable or Enable, Edit limits, Delete (Delete only offered when 0 are used).
- **Empty**: "No codes yet" with a Create code button. A free course shows "Set a price on this course to create codes" and no button.
- **Create code dialog**: Code (optional, with a Generate button), Type (Percent off or Fixed amount), Value (percent, or an amount in the course currency), Expires on (optional date, note "Ends at the end of that day, UTC"), Maximum redemptions (optional), Create and Cancel. Errors from the API show under the dialog; a duplicate shows on the Code field.
- **Edit limits dialog**: Expires on and Maximum redemptions only, with "At least N, the redemptions already held" as the hint.
- States: loading skeleton, error with Retry, saving disabled buttons.

## Student portal: code field on the enrol or pay area

In `enrolment-actions.tsx`'s paid state (from #284), above the pay button:

- A "Have a code?" link reveals a text field and an Apply button.
- **Applied**: a summary: List price, Discount (with the code), Total, and a Remove code button; the pay button label shows the total ("Pay $12.00"). A zero total changes the button to "Enrol for free" and notes that no payment is needed.
- **Refused**: the API's message under the field, price unchanged.
- **Checkout**: pressing the button calls checkout start with the code; a refusal at that point (the code expired since) shows its message and refreshes the summary without the code.
- Loading state while applying; the field is cleared when the student removes the code.
