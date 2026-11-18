# Contract: portal UI

Buttons carry text labels only: no arrow icons. A star in a rating display is a glyph beside text, never the only label; the input is a labelled radio group ("1 star" to "5 stars").

## Student portal

**Rating display** (shared component): "4.6" with the star glyph and "(128 ratings)"; "No ratings yet" when unrated. Used on cards and the course page.

**Course page** (`learn/$courseId`, the public view for signed-out visitors and students alike): a Reviews section with:

- Summary: average, count and a five-row breakdown (stars, count, share of the largest bar); "No ratings yet" and no breakdown when unrated.
- The review form, for a signed-in student whose enrolment is not dropped: rating radios (required), a text area (2,000 characters, counter), a Post review button; with a review of their own it shows that review with Edit and Delete review buttons (Delete asks to confirm), and the edit form shows Save changes and Cancel. A removed review shows "Your review was removed by a moderator" with the reason, and no form. Signed-out visitors see "Sign in and enrol to review"; non-enrolled students see "Enrol in this course to review it".
- A list of reviews, newest first: name, stars, date, "edited" mark, text (plain text, line breaks kept), the instructor's response under it, and a Load more button.
- States: loading skeleton, empty ("Be the first to review this course" for an enrolled student, "No reviews yet" otherwise), error with a retry; a `CONFLICT` on save shows "Your review changed; reload it" and a Reload button.

**Search page**: Sort select and Minimum rating select as in [search-and-catalogue.md](./search-and-catalogue.md); the selections stay in the URL.

## Instructor portal

A Reviews screen at `my-courses/<courseId>/reviews`, linked from the course page: the course's average and breakdown, then reviews newest first with name, stars, text, and a Respond button (Edit response and Delete response when one exists) opening a dialog with a 1,000-character text area. States: loading, empty, error with retry.

## Admin portal

A Reviews screen at `/reviews`: a course picker (published and archived courses with their rating counts), then the course's reviews, all statuses, removed ones marked with reason. A Remove button on a visible review opens a dialog asking for a reason (required, 200 characters). States: loading, empty, error with retry.
