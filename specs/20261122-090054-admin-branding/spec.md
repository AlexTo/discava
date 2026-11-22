# Feature Specification: Admin-Set Platform Branding

**Feature Branch**: `20261122-090054-admin-branding`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Let admins set their own platform branding from the admin portal: upload an icon (favicon/app icon), a logo (shown in the portal headers and public pages), and optionally choose a color theme (primary/accent colors) that applies across the student, instructor and admin portals and the public course landing pages."

**Design page**: [`design/branding`](../../docs/src/content/docs/en/design/branding.mdx)

**Parent issue**: none. Related: #45 (design a Discava icon and logo, which becomes the default brand) and #52 (brand Cognito's hosted sign-in pages).

## Context

Discava's brand is fixed in code today. The platform name ("Discava") and the header logo come from one shared configuration, each portal ships its own browser-tab icon, the public pages carry a fixed default share image, and every portal uses the same neutral colour palette. A school or company running its own Discava deployment cannot make it look like theirs without changing code and redeploying.

This feature lets an admin set the deployment's brand from the admin portal: its name, logo, icon and brand colour. Every portal and every public page then shows that brand, with no code change and no redeploy.

## Clarifications

### Session 2026-11-22

- Q: How much control over colours should an admin get? → A: One brand colour, any hex value. It drives the primary and accent elements; the system picks readable text on it and refuses colours that cannot reach 4.5:1 contrast. No second accent colour and no preset themes.
- Q: Should the admin-set brand also appear on the deployed stage's Cognito-hosted sign-in and sign-up pages? → A: No. Out of scope; they keep the look #52 gives them, and applying the admin brand there is a follow-up.
- Q: After an admin saves a brand change, how quickly must every visitor see it? → A: Within 5 minutes for every new page load; the admin who saved sees it straight away in the admin portal.
- Q: What should the link preview of a public page without its own image show on a custom-branded deployment? → A: A default share image the admin uploads as part of the brand, falling back to the Discava one.
- Q: How should portal headers handle logos of different shapes, including wide wordmarks that already contain the name? → A: Any logo up to 4:1 wide is accepted and scaled to the header height. A "show platform name beside the logo" setting, on by default, lets an admin hide the name text when the logo already contains it; the name is still used in page titles and the logo's alt text.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin uploads a logo and icon (Priority: P1)

An admin opens the branding settings in the admin portal, uploads their organisation's logo and a square icon, checks the preview, and saves. From then on, the student, instructor and admin portals show that logo in their headers, browser tabs and bookmarks show the icon, and the public course landing pages and instructor profiles show the logo too.

**Why this priority**: The logo and icon are what people recognise first, and they are what the request names. On their own they make the deployment look like the organisation's.

**Independent Test**: Sign in as an admin, upload a logo and an icon, save, then open each portal and a public course landing page and confirm the new logo and tab icon appear, replacing the Discava defaults.

**Acceptance Scenarios**:

1. **Given** the deployment uses the default Discava brand, **When** an admin uploads a valid logo and saves, **Then** the student, instructor and admin portal headers and the public pages show the new logo on their next page load.
2. **Given** the deployment uses the default Discava brand, **When** an admin uploads a valid square icon and saves, **Then** the browser tab icon, the bookmark and home-screen icon of every portal and public page show the new icon on their next page load.
3. **Given** an admin has chosen a logo but not yet saved, **When** they look at the branding settings, **Then** they see a preview of a portal header with the new logo, and nothing visitors see has changed.
4. **Given** an admin uploads a file that is not an accepted image type, is too large, or has the wrong shape (an icon that is not square, a logo more than 4 times wider than tall or taller than wide), **When** they try to save, **Then** the upload is refused with a message saying which rule it broke, and the current brand is unchanged.
5. **Given** a signed-in user who is not an admin, **When** they try to view or change branding settings, **Then** they are refused and nothing changes.

---

### User Story 2 - Admin sets the platform name and share image (Priority: P2)

An admin changes the platform's display name from "Discava" to their organisation's name (for example "Acme Academy"). The new name appears next to the logo in the portal headers, in browser tab titles, in the alt text of the logo and in the site name shown when a course link is shared on social media or chat apps. The admin also uploads a default share image, which link previews use for public pages that have no image of their own.

**Why this priority**: A logo beside someone else's product name, or a shared link previewing with the Discava image, looks unfinished. Both are cheap to change and complete the brand, but the logo alone already delivers most of the value.

**Independent Test**: Change the platform name and upload a share image, then confirm a portal header, a browser tab title and the share preview of a public course landing page all use the new name, and the share preview of an instructor profile without a photo uses the new image.

**Acceptance Scenarios**:

1. **Given** the platform name is "Discava", **When** an admin saves "Acme Academy" as the name, **Then** portal headers, page titles and the site name in public pages' share previews say "Acme Academy".
2. **Given** an admin enters a blank name or one longer than the limit, **When** they try to save, **Then** the save is refused with a message and the current name is kept.
3. **Given** an admin has uploaded a default share image, **When** someone shares the link to an instructor profile without a photo or a course without a cover image, **Then** the link preview shows the uploaded image; a course with a cover image still previews with its cover.

---

### User Story 3 - Admin chooses a brand colour (Priority: P3)

An admin picks a brand colour. Primary buttons, active navigation items, focus rings, other accent elements and (when readable on the page background) links in all three portals and on the public pages take on that colour. The settings page shows a live preview and warns before saving a colour whose text would be hard to read.

**Why this priority**: Colour makes the brand feel complete, but the request calls it optional, and the default neutral palette works for any logo.

**Independent Test**: Choose a brand colour, save, then open each portal and a public page and confirm primary buttons use it, with readable text on top.

**Acceptance Scenarios**:

1. **Given** the default palette, **When** an admin saves a brand colour, **Then** primary buttons, active navigation and focus indicators in all three portals and on the public pages use that colour on their next page load, and links use it too if it reaches 4.5:1 against the page background.
2. **Given** an admin picks a colour, **When** they view the preview, **Then** it shows sample buttons, a link and navigation in the brand, with the text colour on those elements chosen for readability.
3. **Given** an admin picks a colour against which no text colour reaches the readability threshold, **When** they try to save, **Then** the save is refused with a message explaining that text on it would be unreadable.

---

### User Story 4 - Admin resets to the default brand (Priority: P3)

An admin who is unhappy with a change resets any part of the brand (name, logo, icon or colour) back to the Discava default, or resets all of it at once.

**Why this priority**: A safety net. Without it a bad upload can only be fixed by finding and re-uploading the previous file.

**Independent Test**: With a custom logo and colour saved, reset each one and confirm the portals return to the Discava default for that part only.

**Acceptance Scenarios**:

1. **Given** a custom logo and a custom colour, **When** an admin resets only the logo, **Then** the portals show the default Discava logo and keep the custom colour.
2. **Given** a fully custom brand, **When** an admin resets all branding and confirms, **Then** every portal and public page shows the default Discava brand.

---

### Edge Cases

- **No brand set yet**: a new deployment, or one whose admin never opened the settings, shows the default Discava name, logo, icon and palette everywhere. Nothing is blank or broken.
- **Brand cannot be loaded**: if the brand settings or an uploaded image cannot be fetched when a page loads, that page falls back to the default for the missing part and still works.
- **Two admins edit at once**: each saves the whole brand form. A save made against an older version of the brand than the one now stored is refused with a message to reload, so one admin cannot silently undo the other's change.
- **Very wide, very tall or transparent logos**: a logo taller than it is wide, or more than 4 times wider than tall, is refused (FR-003). An accepted logo is scaled to the header height without distortion or cropping; on narrow screens where the name text is already hidden, a wide logo is scaled down to fit beside the header's controls. A transparent logo must stay visible on the header background.
- **Scalable vector images**: an uploaded vector image is accepted only if it cannot run scripts or load outside content in a visitor's browser.
- **A replaced image**: after an admin replaces the logo or icon, visitors do not keep seeing the old one for longer than the propagation time in SC-002, even if their browser cached it.
- **Pages already open**: a user with a portal open sees the new brand on their next page load, not mid-session.
- **Issued certificates and shared links**: certificate pages and existing share links show the current brand when opened, not the brand at the time they were issued or shared.
- **Hosted sign-in pages**: the deployed stage's sign-in and sign-up pages, which AWS hosts, are out of scope here; they keep their own look (see Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

**Managing the brand**

- **FR-001**: The admin portal MUST provide a branding settings page where an admin can view and change the platform name, logo, icon, default share image and brand colour.
- **FR-002**: Only admins MUST be able to change branding. Any other signed-in user or anonymous visitor MUST be refused, and the refusal MUST leave the brand unchanged.
- **FR-003**: Admins MUST be able to upload a logo in PNG, JPEG, WebP or SVG format, up to 1 MB, with a width-to-height ratio between 1:1 and 4:1.
- **FR-004**: Admins MUST be able to upload an icon in PNG format, up to 1 MB, square and at least 192 × 192 pixels. (Amended in planning: home-screen icons on iOS cannot be SVG, so SVG icons could not meet FR-015 everywhere.)
- **FR-004a**: Admins MUST be able to upload a default share image in PNG, JPEG or WebP format, up to 2 MB, at least 1200 × 630 pixels with a width-to-height ratio between 1.8:1 and 2:1.
- **FR-005**: The system MUST refuse an uploaded image that does not meet FR-003, FR-004 or FR-004a, with a message naming the rule broken, and MUST keep the current brand unchanged.
- **FR-006**: The system MUST make sure no uploaded image can run scripts or load outside content in a visitor's browser.
- **FR-007**: Admins MUST be able to set the platform name: 1 to 50 characters, not only whitespace.
- **FR-007a**: Admins MUST be able to choose whether the platform name is shown as text beside the logo in portal headers. It is shown by default. Hiding it MUST NOT remove the name from page titles, share previews or the logo's alt text.
- **FR-008**: Admins MUST be able to choose one brand colour, either by picking it or by entering a hex value.
- **FR-009**: The system MUST choose the text colour shown on brand-coloured elements so that it meets a contrast ratio of at least 4.5:1 against the brand colour, and MUST refuse a brand colour for which neither light nor dark text reaches that ratio.
- **FR-010**: The branding settings page MUST show a preview of the unsaved brand (a portal header, primary and secondary buttons, a link and an active navigation item) before the admin saves.
- **FR-011**: Admins MUST be able to reset the name, logo, icon, default share image or colour individually, or all at once, to the Discava default. Resetting all MUST ask for confirmation.
- **FR-012**: The system MUST refuse a save based on an older version of the brand than the one stored, and tell the admin to reload.
- **FR-013**: The system MUST record who last changed the brand and when, and show it on the branding settings page.

**Showing the brand**

- **FR-014**: The student, instructor and admin portals MUST show the current logo, scaled to the header height without distortion, and (unless hidden under FR-007a) the platform name in their header or sidebar wherever the default Discava logo and name appear today.
- **FR-015**: Every portal page and public page MUST use the current icon as its browser tab, bookmark and home-screen icon.
- **FR-016**: Page titles in all three portals and on the public pages MUST use the current platform name where they use "Discava" today.
- **FR-017**: Public pages (course landing pages, instructor profiles, certificate pages, the not-found page) MUST use the current platform name as the site name in share previews, and the current logo and colour wherever they show the brand. A public page without an image of its own (an instructor profile without a photo, a course without a cover image, the home page) MUST use the current default share image as its share preview image.
- **FR-018**: When a brand colour is set, primary actions, active navigation, focus indicators and the other accent elements (selected tabs, toggles, progress bars, badges) MUST use it in all three portals and on the public pages. Links MUST use it only when it reaches a contrast ratio of at least 4.5:1 against the page background, and otherwise keep the default text colour (amended in planning: a pale brand colour would make links unreadable). Elements that convey meaning by colour (errors, warnings, success) MUST keep their own colours.
- **FR-019**: Any part of the brand not set by an admin MUST fall back to the Discava default, and any part that cannot be loaded MUST fall back to the default without breaking the page.
- **FR-020**: A saved brand change MUST reach every new page load within 5 minutes (SC-002), including for visitors whose browsers cached the previous logo or icon. The admin who saved MUST see the new brand in the admin portal straight away, without waiting.
- **FR-021**: Branding MUST work in local development with no AWS account, using the same admin flow and a local stand-in for image storage.

### Key Entities

- **Platform Brand**: the one brand of a deployment. Holds the platform name, the current logo, icon and default share image (each optional; absent means the default), the brand colour (optional), whether the name is shown beside the logo, a version that changes on every save, and who last changed it and when. Exactly one exists per deployment.
- **Brand Image**: an uploaded logo, icon or default share image file. Has a kind (logo, icon or share image), format, size and dimensions. Replacing a brand image makes the old one unused; visitors are never served a mix of old and new versions of one brand.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can replace the logo, icon, default share image, name and colour of the platform in under 5 minutes, without help from a developer and without a redeploy.
- **SC-002**: After an admin saves a change, 100% of new page loads in every portal and on every public page show the new brand within 5 minutes.
- **SC-003**: Every brand colour the system accepts gives text on brand-coloured elements a contrast ratio of at least 4.5:1, measured on the preview and on the live portals.
- **SC-004**: Showing a custom brand adds no visible delay: pages still show their first content as fast as with the default brand, with no flash of the default logo or colours before the custom ones appear on a normal connection.
- **SC-005**: When the brand settings cannot be loaded, 100% of portal and public pages still render, showing the default brand.
- **SC-006**: 0 non-admin attempts to change the brand succeed.

## Assumptions

- **One brand per deployment.** Discava runs as one platform per deployment (stage), so there is one brand for the whole deployment, not per instructor, course or organisation. Multi-tenant or per-course branding is out of scope.
- **One brand colour.** One brand colour drives both the primary and accent elements; the rest of the palette (backgrounds, borders, muted text) stays at the defaults. A separate accent colour, preset themes, fonts and a full custom palette are out of scope.
- **No dark-mode variant.** The portals have no dark mode today, so the brand covers the one (light) theme. A dark-mode logo or colour is out of scope until the portals add dark mode.
- **Platform name is included.** The request names icon, logo and colours. A custom brand with "Discava" left in every title and header would look broken, so the platform name is included as P2.
- **Default brand.** The Discava name, logo, icon and neutral palette in use today remain the defaults. When #45 delivers a designed Discava logo, it replaces the default; this feature does not depend on it.
- **Hosted sign-in pages are out of scope.** The deployed stage's sign-in and sign-up pages are hosted by AWS and configured at deploy time; #52 covers branding them with the default Discava look. Applying the admin-set brand to them is a follow-up, not part of this feature. Local development's sign-in page is a stand-in and is not branded either.
- **Not branded by this feature**: the documentation site, notifications' wording, and per-course share images (a course with a cover image keeps using it).
- **Who counts as an admin** is the existing admin group the admin portal already requires.
