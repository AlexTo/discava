# Contract: Student portal UI

Behavior and states, not layout. shadcn components from `@discava/common-shadcn`. Buttons carry text only: no arrow icons.

## Outline

- Each lesson of kind `assignment` shows an assignment icon, the label "Assignment", its title, and "Due <date and time in the student's time zone>" when `dueAt` is set.
- A completed assignment shows the same done mark as other items.
- Opening an assignment goes straight to its item: the existing quiz view for a quiz assignment, the submit screen below for an upload assignment. There is no list of content items.

## Submit screen (upload assignment)

Always shown: title, instructions (Tiptap body, read-only), due date, maximum points, and the limits: "One file, up to 100 MB. Allowed: <extensions>".

| State | What the student sees and can do |
|-------|----------------------------------|
| No submission yet | Empty file picker ("Choose file"), disabled **Submit** |
| File chosen | The file (name, size, remove), **Submit** enabled. Choosing another file replaces it |
| Refused before upload | Inline reason next to the file: "<name> is over 100 MB", "<name> can't be attached (type)". Nothing is uploaded or submitted |
| Uploading | Upload progress; remove and submit disabled |
| Submitting | **Submit** shows a busy label, form disabled |
| Submitted | Confirmation "Submitted <date and time>" with "Version <n>", plus "Late" notice when `late`; the file with a **Download** button; item marked done; **Resubmit** button |
| Resubmit form | Shows the current file; "Choose file" picks its replacement; **Submit** is enabled once one is chosen and replaces the current file |
| Past the due date, no submission | Shown as normal with a note "This assignment is past due. Late work is accepted and marked late" |
| Past the due date, submitting | Same form; after success the "Late" notice shows |
| Conflict | "Your submission changed while you were sending it. Try again" with **Try again**, and the form keeps the chosen file |
| Locked (returned) | The file and details stay visible and downloadable; no **Resubmit**; text: "This submission has been returned and can't be changed" |
| Upload or submit failed (network or server) | After a failed submit the portal re-reads `mySubmission` first. If it shows the file just sent, the Submitted state is shown. Otherwise: "Something went wrong and your work was not submitted", plus "Your earlier submission is unchanged" when there is one, with **Try again** |
| Unavailable | Assignment hidden, archived, or student not enrolled: the usual "no longer available" page; no submission details |
| Course archived | Details and downloads work; submit and resubmit are not offered, with "This course is archived" |

## Accessibility and responsiveness

- Everything works with the keyboard only: the file picker, remove buttons, **Submit**, **Resubmit** and downloads are reachable and labelled.
- Progress and errors are announced to assistive technology (live region).
- The screen works at phone width with no horizontal scroll.

## Testing

Component tests cover each state above (`assignment-item.test.tsx`); the e2e scenario covers submit, late, resubmit with a replacement file, the refusals, and the hidden-assignment case. Screenshots of key steps go in `tmp/screenshots/pr-<number>/`.
