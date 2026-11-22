# Contract: checks added to the UI rules

`packages/websites/CLAUDE.md` holds the portals' UI rules. The instructor-portal UX spec adds checks for most patterns this audit found again in the admin portal ([its contract](../../20261123-000428-instructor-portal-ux-fixes/contracts/ui-rules.md)): `PendingButton`, focus after a control removes itself, `useReturnFocus`, quiet counters, errors in their confirmation, Save never disabled for an incomplete form, Cancel and Escape. They are not repeated here.

One pattern isn't covered by either: a table at phone width. It is behind B-01 (categories, 1,003px) and E-01 (payment changes). The check below is added to "Layout", in the same voice: a yes-or-no check that came from a defect.

Nothing here repeats a rule already in that file: "a row of tabs or chips scrolls inside itself" covers chips, not tables, and "User-written text has a limit on how much shows" covers titles and descriptions, not table cells.

---

## Addition to `packages/websites/CLAUDE.md`

### Under "Layout"

```markdown
- A table fits 375px one of two ways. A table whose rows hold actions stacks below `sm`: each row is a block, its name first across the full width, its other values labelled in words (the header row is hidden), and its actions on a line that wraps. A read-only table scrolls inside an `overflow-x-auto` region that is focusable and named by its heading. Either way, cells have horizontal padding, and a cell holding a name or a code breaks long words (`break-words`, `break-all` for codes).
```
