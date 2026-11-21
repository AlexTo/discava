# Feature Specification: Deploy-Time Settings for Backend Functions

**Feature Branch**: `20261122-093927-runtime-config-env`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Replace AppConfig runtime lookups with Lambda environment variables, and drop or shrink the RuntimeConfig stack. Context in GitHub issue #777 (cost, readers, page-renderer dependency cycle, two-step rollout, how to test)."

**Parent issue**: #777

## Clarifications

### Session 2026-11-22

Non-interactive run: each question was answered with the recommended option, for the owner to confirm on the pull request.

- Q: How does the page renderer get the table name and public media address, given its stack deploys before the stack that creates them? → A: The stack that creates them also writes them to one free standard parameter in the parameter store, at a name derived from the stage (known when the renderer is deployed, as the configuration application's name is today). The renderer reads it once per function instance and keeps it. Moving the renderer to a later stack would make the student portal's distribution depend on a later stack, which is a cycle.
- Q: Is the final stack removed or kept for the portals' configuration files? → A: Kept, holding only the portals' `runtime-config.json` deployments, and renamed `PortalConfig`. No existing stack deploys after every stack those files read from, so moving them would need a new dependency chain for no gain.
- Q: How is the change rolled out to an existing stage, given the configuration application's stack is deployed before the stack that imports its identifier? → A: In two implementation pull requests, each deployed to `discava-development` after merge. The first switches every reader and removes the content, permissions and identifier variables, but leaves the configuration application, environment and deployment strategy in place, unused. The second removes those. No compatibility code is written, and production follows the same two deploys.
- Q: How does an operator point `seed-categories` or `rebuild-analytics` at a deployed stage? → A: By setting the same table-name setting the functions use, read from a new output of the stack that holds the table. The first-deploy guide gives the one-line command to read the output, as it does today for the configuration application's identifier.
- Q: Which settings fail loudly when absent and which keep a default? → A: Only the caption language and the caption translation settings keep today's defaults (the stage's transcription language; translation off). Every other setting is required and fails on first use naming the setting. The stack test makes sure the defaulted ones are always given on a deployed stage, so their defaults only apply to tests and hand-edited deploys.

## User Scenarios & Testing *(mandatory)*

The "users" of this feature are the people who run and pay for a deployed stage, and the contributors and agents who add backend functions. Learners, instructors and admins should see no change.

Today every backend function learns the stage's resource names and settings at runtime: the table name, bucket names, the search endpoint, media pipeline and scheduler details, and the caption translation settings. It fetches them from the stage's hosted configuration service the first time each new function instance needs them. That service charges for every configuration it hands out, at about 4,000 times its per-request price. Every cold start pays it once per settings group read, so a cold start can pay two to four times. On `discava-development` the count went from 2,215 fetches in September to 13,709 in October and 37,576 in the first 22 days of November. That is about $30 a month at list price, and it grows with deploys, test runs and traffic bursts rather than with users. None of these values change between deploys, so they can be handed to each function when it is deployed.

### User Story 1 - A stage pays nothing to tell its functions their settings (Priority: P1)

An operator deploys a stage and runs it as usual: test runs, deploys and bursts of traffic. The stage's bill has no charge for handing settings to functions, however many function instances start. A function that starts has everything it needs before it runs, with no extra network call.

**Why this priority**: This is the reason for the feature: a cost that grows with every cold start for values that never change between deploys.

**Independent Test**: Deploy the stage, run the end-to-end suite against it or exercise its main flows, and check the next day's bill and usage records: there is no configuration-received or configuration-request usage for the stage.

**Acceptance Scenarios**:

1. **Given** a deployed stage, **When** any backend function starts and handles a request or event, **Then** it reads its settings from what it was deployed with and makes no call to a configuration service.
2. **Given** a day of normal use, test runs and a deploy, **When** the billing records are checked the next day, **Then** the stage has no configuration-service usage and no charge for it.
3. **Given** a backend function, **When** its deployed permissions are inspected, **Then** it has no permission to read from a configuration service.

---

### User Story 2 - Everything keeps working after the switch (Priority: P1)

Every flow that depended on the old lookup behaves exactly as before on a deployed stage. These are signing in, browsing and searching the catalogue, watching a lesson video, uploading and transcoding a video, captions and their translations, certificate reminders, payments and payouts, public course pages, notifications, and analytics.

**Why this priority**: The change is only acceptable if nothing a user can see changes. A setting a function silently fails to receive would break a flow only on a deployed stage, where local development doesn't catch it.

**Independent Test**: Run every existing unit, stack and end-to-end test unchanged, then walk each flow on a deployed stage and check its function logs show no missing-setting error.

**Acceptance Scenarios**:

1. **Given** the switch is deployed, **When** each flow in the list above is exercised on a deployed stage, **Then** it gives the same result as before.
2. **Given** a function that is deployed without a setting it requires, **When** the stage's tests run before deploy, **Then** a test fails and names the function and the missing setting.
3. **Given** a function that runs without a setting it requires (for example a hand-edited deploy), **When** it first needs the setting, **Then** it fails with an error naming the setting, rather than silently using a wrong or empty value.
4. **Given** a setting that is optional today and has a documented default (the caption language, the caption translation settings), **When** it isn't provided, **Then** the function uses the same default as today.

---

### User Story 3 - The stage no longer carries a configuration service (Priority: P2)

A contributor reading the stage's infrastructure finds no hosted configuration application, profiles, versions or deployments. The final stack, which today holds that content and each portal's `runtime-config.json`, keeps only the portals' files and is renamed `PortalConfig` for that job.

**Why this priority**: Removing the unused resources keeps the stage simpler and stops anyone adding a new runtime lookup by habit, but the cost saving doesn't depend on it.

**Independent Test**: Synthesise the stage and check no template contains configuration-service resources or permissions, and the portals still get a `runtime-config.json` with the same content as before.

**Acceptance Scenarios**:

1. **Given** the synthesised stage, **When** its templates are inspected, **Then** none contains a configuration-service resource or a permission to read one.
2. **Given** the synthesised stage, **When** each portal's `runtime-config.json` is compared with today's, **Then** its content is unchanged (sign-in settings, API addresses, portal and media addresses, site settings).
3. **Given** the final stack, **When** its contents are listed, **Then** it is named `PortalConfig`, still deploys last, and holds only the portals' configuration file deployments.

---

### User Story 4 - Existing stages upgrade in place (Priority: P2)

An operator upgrades `discava-development` and `discava-production` with the normal deploy command, without destroying either stage. The deploy doesn't fail because one stack still uses something another stack is removing.

**Why this priority**: Production has to deploy in place. Development data is disposable, but recreating the stage costs a manual reset of sign-in users and test data.

**Independent Test**: Deploy the change over an existing `discava-development` stage that was deployed from `main`, using the documented steps, and check every stack updates and the flows in User Story 2 still work.

**Acceptance Scenarios**:

1. **Given** a stage deployed from `main` before this change, **When** the documented upgrade steps are followed, **Then** every stack updates without failing and no stack has to be destroyed.
2. **Given** the first of the two pull requests is deployed, **When** the flows are exercised, **Then** they work, the configuration application still exists but nothing reads it, and the second deploy removes it without failing.

---

### User Story 5 - Operator scripts still target a deployed stage (Priority: P3)

An operator runs `seed-categories` or `rebuild-analytics` against a deployed stage, which today finds its table through the configuration service. After the change they point it at the stage the documented way and it writes to that stage's table.

**Why this priority**: These are occasional operator tasks, needed for a first deploy and for repairs, but not part of any request path.

**Independent Test**: Follow the first-deploy guide's seeding step against `discava-development` and check the categories are written to that stage's table.

**Acceptance Scenarios**:

1. **Given** a deployed stage and its credentials, **When** the operator reads the table name from the stage's output and runs `seed-categories` or `rebuild-analytics` with it, **Then** it writes to that stage's table.
2. **Given** no table name is given, **When** either script runs, **Then** it uses the local table, as today.

---

### Edge Cases

- A function reads a setting that another stack publishes and that stack deploys *after* the function's own stack. A direct reference would create a stack cycle. The page renderer is the known case: it is deployed with the student portal in the first stack, but needs the table name and the public media address, which are created by a later stack. A stack cycle MUST NOT be introduced (FR-007).
- A function needs its own address (for example a scheduler target that points at the function that created it). A reference to itself is a cycle within one resource and has to be built from a known name instead.
- A function's settings exceed the limit on what a function can be deployed with (4 KB of environment in total). Today's largest set is a few hundred bytes, so this doesn't apply now, but a stack test guards it.
- A secret (payment keys, the media signing key, the unsubscribe secret) MUST NOT become a deploy-time value. Only where to find it may, as some already are.
- A value that a stage's configuration changes (for example the caption translation language limit) takes effect on the next deploy, as it does today.
- Local development already bypasses the configuration service and MUST keep working unchanged.
- A setting read today with a silent fallback (caption language, caption translation settings, which turn off when unreadable) keeps its fallback. The stack test makes sure every function that reads it is given it, so the fallback never hides a missing setting on a deployed stage.
- The index-sync step already receives the search endpoint at deploy time because it runs before the old configuration is published. It keeps working the same way.

## Requirements *(mandatory)*

### Functional Requirements

**Settings at deploy time**

- **FR-001**: Every backend function on a deployed stage MUST receive the resource names and settings it reads when it is deployed, and MUST NOT fetch them from a configuration service at runtime. This covers the table name, bucket names and their media addresses, the search endpoint, the media pipeline and cleanup details, the certificate reminder details and the caption translation settings.
- **FR-002**: Each function MUST receive only the settings it reads, not the whole stage's settings.
- **FR-003**: A function that needs a required setting and wasn't given it MUST fail on first use with an error naming the setting. It MUST NOT fall back silently to an empty or default value.
- **FR-004**: Only the caption language and the caption translation settings MAY be absent. They MUST keep today's defaults (the stage's transcription language; translation off) and behaviour when absent. Every other setting is required (FR-003).
- **FR-005**: Secrets MUST stay in the secret store. Only their identifiers may be passed at deploy time.
- **FR-006**: The shape of each setting a function reads (names, units, which values are optional) MUST stay the same, so the code that uses a setting changes only in where it reads it from.

**Stack structure**

- **FR-007**: The change MUST NOT introduce a dependency cycle between stacks, and MUST keep today's deploy order unless the plan records why it changes. Where a function cannot reference a value because the value's stack deploys later (the page renderer), the value MUST be written by the stack that creates it to one free standard parameter at a stage-derived name, which the function reads once per instance and keeps. This adds no cycle and no per-request or per-start charge.
- **FR-008**: The stage MUST have no configuration-service resources (application, environment, deployment strategy, profiles, hosted versions, deployments) and no function or role MUST have permission to read one.
- **FR-009**: Each portal's `runtime-config.json` MUST keep its current content and stay uncached. It MUST still be deployed after every stack whose values it contains.
- **FR-010**: The final stack MUST keep only the portals' configuration file deployments and MUST be renamed `PortalConfig`. It still deploys last.
- **FR-011**: The stage's deploy role permissions (set up by `scripts/setup-stage.sh`) MUST drop the configuration-service permissions the deploy no longer needs.

**Upgrading existing stages**

- **FR-012**: The change MUST deploy over an existing stage without destroying any stack. It MUST land in two pull requests, each deployable on its own: the first switches every reader and removes the configuration content, the read permissions and the identifier variables, leaving the configuration application, environment and deployment strategy unused; the second removes those. The steps MUST be documented, and no compatibility code is written.
- **FR-013**: `discava-production` MUST be upgradable in place by the same steps.

**Operator scripts**

- **FR-014**: `seed-categories` and `rebuild-analytics` MUST target a deployed stage when given the same table-name setting the functions use, read from a new output of the stack that holds the table, and MUST keep using the local table when it isn't given.
- **FR-015**: The first-deploy guide's seeding step MUST be updated to the new command.

**Tests**

- **FR-016**: A stack test MUST fail when any function that is granted access to a resource whose name or address it reads at runtime (the core table, a bucket, the search collection) isn't given the matching setting. This replaces today's check that such functions can read the configuration service.
- **FR-017**: A stack test MUST fail when any template in the stage contains a configuration-service resource or permission.
- **FR-018**: Each changed settings reader MUST have unit tests: it returns the deployed value, fails naming the setting when a required one is absent, keeps its default when an optional one is absent, and uses the local value under local development.
- **FR-019**: Existing tests MUST pass unchanged except where a task names the behaviour change that justifies the edit (tests that mock the configuration service, or assert its permissions or its identifier variable).
- **FR-020**: The stage's existing end-to-end suite MUST pass unchanged under local development.

**Documentation**

- **FR-021**: The architecture, security and design pages, the stack-order comment and the nested `CLAUDE.md` files that describe the configuration service MUST describe deploy-time settings instead. The contributor docs MUST say how a new function is given a setting, so no one adds a runtime lookup by habit.

### Key Entities

- **Deploy-time setting**: a named value a function is deployed with (a resource name, an address, a switch). It changes only when the stage is redeployed.
- **Settings reader**: the small piece of shared code that turns a function's deploy-time settings into the typed value its callers use today, with the local-development value when running locally.
- **Portal configuration file** (`runtime-config.json`): the public, uncached file each portal reads at start-up. Its content doesn't change in this feature, only which stack deploys it.
- **Configuration-service resources**: the hosted configuration application and everything under it, which this feature removes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The day after the change is deployed and used, the stage's billing records show zero configuration-service usage and $0 for it, against 37,576 configurations received in the first 22 days of November 2026.
- **SC-002**: No function on a deployed stage makes a configuration-service call, shown by the absence of any permission to make one: a missed reader would fail loudly, not keep costing.
- **SC-003**: 100% of the existing unit, stack and end-to-end tests pass, with no test weakened except where a task names the reason.
- **SC-004**: Every flow listed in User Story 2 works on a deployed stage after the change, checked by a person against a list.
- **SC-005**: A function's first request after a cold start is no slower than before, and typically faster, because the settings fetch is gone.
- **SC-006**: `discava-development` upgrades in place following the documented steps, with no stack destroyed.
- **SC-007**: Adding a new backend function that reads a resource takes one line per setting in its stack and no new runtime lookup, and a stack test catches a missing one.

## Assumptions

- Discava has not launched, so readers are switched outright with no fallback to the configuration service (constitution principle VII). Development data needs no migration: settings are not data.
- Every value read at runtime today is fixed at deploy time. Nothing writes to the configuration service between deploys, so no runtime-changeable setting is lost.
- The page renderer is the only reader that can't reference its values directly, because its stack deploys before the stack that creates them (Clarifications). Standard parameters in the parameter store have no storage charge and no charge for standard-throughput reads, and one read per renderer instance is far below the standard throughput limit. Planning confirms both against current documentation.
- Removing the configuration application in a second pull request is what lets each deploy succeed: the stack that imports its identifier stops importing it in the first deploy, so the second can delete it.
- A function's settings stay far below the 4 KB environment limit. The largest today is the media pipeline's, at a few hundred bytes.
- Out of scope: changing what any setting means, the portals' configuration file's content or the web code that reads it, moving secrets, and any other cost on the stage.
