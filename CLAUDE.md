# Working in this repo

## Pull requests

When you open a PR, enable GitHub auto-merge on it immediately, while its checks
are still pending. Auto-merge cannot be armed once a PR is already green —
GitHub rejects it and the PR then has to be merged by hand, which is the thing
this is here to avoid.

What auto-merge waits on is a ruleset on `main` requiring the `build` check from
`.github/workflows/ci.yml`. Without a required check there is nothing to wait
for, and GitHub declines to arm auto-merge at all — so if that ruleset is ever
removed, the instruction above stops working rather than failing loudly.

Do not add `report-build-status` as a required check. It belongs to the built-in
`pages-build-deployment` workflow, which only runs on pushes to `main`; required
on a PR, it would never arrive and the PR could never merge.
