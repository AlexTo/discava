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
The issue says only what to test. How to test it (the tools, the test users,
the checks and the report) is the test agent's own prompt in OpenHands, so
nobody who can edit an issue can change it.
-->

## What to test

- Pull request: #<pr> (<its title>)
- Issue it closes: #<issue>
- Merged as `<merge commit>`, deployed to `discava-development` at `<deployed commit>`
- Kind: **UI change** or **backend change or fix**
