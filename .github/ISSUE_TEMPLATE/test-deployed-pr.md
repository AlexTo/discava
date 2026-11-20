---
name: Test a merged pull request on the deployed stage
about: Hand a merged, deployed pull request to the test agent to verify end to end
title: "test(post-merge): verify #<pr> <what it changed>"
labels: []
---

<!--
The Post-merge Verify workflow opens these by itself once Deploy has put a
merged pull request on discava-development (or run it by hand with a pull
request number). By hand: fill in "What to test", then add the
`openhands-test` label; the agent picks the issue up on its next poll.
Everything from "What the agent has" on is copied into each issue, with <pr>
and <stage> filled in.
-->

## What to test

- Pull request: #<pr>

## What the agent has

- **AWS CLI, already signed in** to the account that holds the `<stage>-*` CloudFormation stacks (check with `aws sts get-caller-identity`). Use it read-only, apart from the test data you create through the app.
- **Cognito test users**, one per role, in environment variables: `DISCAVA_STUDENT_USERNAME` / `DISCAVA_STUDENT_PASSWORD`, `DISCAVA_INSTRUCTOR_USERNAME` / `DISCAVA_INSTRUCTOR_PASSWORD`, `DISCAVA_ADMIN_USERNAME` / `DISCAVA_ADMIN_PASSWORD`.
- **Playwright** with Chromium, to drive the portals.
- **`gh`**, to read the pull request and comment on this issue.

Finding the stage:

- `aws cloudformation describe-stacks --query "Stacks[?starts_with(StackName, '<stage>')].[StackName,Outputs]"` lists every stack's outputs: the portals' CloudFront domains, the APIs' custom domains, the Cognito user pool and client ids, bucket names.
- Each portal serves `/runtime-config.json`: the API URLs, the Cognito client and domain, the media URLs. That is what the portal itself talks to, so use it for the API base URLs.
- `aws dynamodb list-tables`, `aws opensearch list-domain-names`, `aws s3 ls` and `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/` find the rest. The core table's keys and entities are in `packages/databases/core-table/src/entities/`.

## Instructions for the agent

1. **Work out what changed.** Read the pull request (`gh pr view <pr> --comments`), its diff (`gh pr diff <pr>`), the issue it closes and, if it names one, its spec folder under `specs/`. Write down, before testing, what a user should now see or be able to do, which API procedures it touches, and which stored records (DynamoDB items, OpenSearch documents, S3 objects, emitted events) it reads or writes. Include the error cases the change guards against (another user's data refused, a wrong role refused, bad input rejected).
2. **Test the UI, if the change has one.** With Playwright, sign in to the portal as the user the change is for (the portal's "Sign in" button, then the Cognito hosted page; the student portal keeps its session in `sessionStorage`, so sign in again in every new context). Click through the flow the pull request describes, as a user would. Save a screenshot of each key step, including any failure, to `tmp/screenshots/post-merge-pr-<pr>/` with numbered, descriptive names (`01-course-list.png`, `02-…`). Then **look at every screenshot** and check it makes sense: the change is visible, the text and figures are right for the data, nothing is cut off or overlapping, no error alert, no spinner left spinning, no placeholder or `undefined` values. Watch the browser console and network for failed requests too.
3. **Call the APIs.** For a fix or a backend-only change this is the main test; for a UI change, call the procedures behind the screens you clicked. Get an access token with `aws cognito-idp initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id <client id> --auth-parameters "USERNAME=$DISCAVA_STUDENT_USERNAME,PASSWORD=$DISCAVA_STUDENT_PASSWORD"` (or the instructor's or admin's) and send its **AccessToken** (not the IdToken) as `Authorization: Bearer <token>`, as the portals do. The APIs are tRPC over HTTP with no transformer: a query is `GET <api url>/<router>.<procedure>?input=<url-encoded JSON>`, a mutation is `POST <api url>/<router>.<procedure>` with a JSON body. Check each response's status and shape, and that the error cases from step 1 are refused with the right error.
4. **Check the stored data.** After each action, read what it should have written and check it is right: the DynamoDB items (`aws dynamodb get-item` / `query` on the keys the entity defines), the OpenSearch documents (through the search procedure, or the domain), the S3 objects (`aws s3api head-object`, `aws s3 ls`), and the Lambdas' CloudWatch logs for errors around the time you tested (`aws logs filter-log-events --start-time ...`). Asynchronous writes (streams, events, media processing) can take a minute: poll before calling them missing.
5. **Use your own data.** Create what you need through the app, named so it is clearly test data (`pmt-<pr>-<what>`), and don't change or delete data you didn't create. The stage is disposable development data, but other tests run on it too.
6. **Report on this issue.** Comment with: what you tested and how; a table of every check (UI step, API call, stored record, log check) with pass or fail and its evidence (the trimmed response, the item's relevant fields, the screenshot's name and what it shows); and a verdict. Never put a password or token in the comment.
7. **When everything passes**, close this issue after reporting. **When something fails**, say how to reproduce it and leave this issue open. If the cause is clear and the fix is small, open a pull request that fixes it, with a unit test that fails without the fix, Conventional Commits, and `Refs #<pr>` plus this issue in its description; otherwise stop at the report.
8. Never change infrastructure, IAM, Cognito users or stage configuration, never deploy, never touch another stage, never edit `.github/workflows/`, and never merge. If you are blocked (a credential missing, the stage down), comment on this issue with what you tried and stop.
