# Working in this repo

## If this clone is the compute machine

If this session is about running or tending the MXN compute farm — precomputing
runs onto Cloudflare so `/mxn/` loads instead of computing — read
[docs/gpu-runbook.md](docs/gpu-runbook.md) first. It has the run steps, the
Worker setup, the file map of the farm/cache code, and the checks to run after
touching it. The design behind it is [docs/mxn-farm.md](docs/mxn-farm.md).

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
