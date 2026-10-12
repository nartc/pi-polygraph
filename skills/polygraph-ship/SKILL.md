---
name: polygraph-ship
description: Ship from Pi through Polygraph - push a branch, open or update a pull request, mark it ready for review, read CI status and CI job logs - with the mcp__polygraph__* tools. Use when asked to ship, push, create or update a PR, or check CI in a repo that publishes through Polygraph (there is no gh here), and whenever this Pi session is bound to a Polygraph session.
---

# Ship through Polygraph

The Polygraph MCP server is named `polygraph`; its tools are `mcp__polygraph__<tool>`, called from `codemode`:

```js
const shown = await tools.mcp__polygraph__show_session({ sessionId });
text(shown.content[0].text);   // JSON, or prose for a few tools; shown.isError marks a failure
```

Every session tool takes `sessionId` explicitly. Nothing is inferred from the working directory.

## Confirmations

Reading is free (`whoami`, `list_repos`, `list_sessions`, `search_sessions`, `show_session`, `get_ci_logs`, `git_fetch`). Every other Polygraph call opens a confirmation in this Pi window and waits there for the user. So:

- Before the first one, say that a confirmation is about to wait in your window. A worker tells its hub, naming its tmux window, because nobody is watching it.
- Make one publishing call per `codemode` script and print each result as you get it. A declined call throws, and a script that throws loses what it had not printed.
- Declined means stop. Do not retry, and do not publish another way (`git push`, the `polygraph` CLI in bash).
- A session with no interactive UI (print mode, a subagent) is refused outright. Publishing happens in the main session.

## 1. Auth

`whoami` must show `loggedIn: true` and a selected organization. If not, stop and tell the user; `polygraph auth login` and `polygraph account select` are theirs to run.

## 2. Which session

- The system prompt has a `polygraph_session` section: use that id.
- Else the user, the hub or your workstream file names one: use it. The first successful push or PR call binds this Pi session to it.
- Else start one, from the repo's working directory, because the session uses that checkout in place:

  ```js
  const repos = await tools.mcp__polygraph__list_repos({ nameFilter: "<repo name>" });   // find the repository id
  const started = await tools.mcp__polygraph__start_session({ title: "<short title of the task>", selectedRepoIds: ["<id>"] });
  ```

  The result names the session id, and this Pi session is bound to it from then on. Record the id wherever your work keeps such things (a worker: the `Env:` line of the checkpoint).

`/polygraph` shows the binding; `/polygraph bind <id or URL>` and `/polygraph unbind` are the user's commands, not yours.

## 3. The session description

`push_branch`, `create_pr` and `associate_pr` require `description`. It replaces the session's description in the Polygraph app, which people read now and agents read later, without your working tree. Write it as Markdown:

```markdown
## Goal
<what the session is for>

## Current progress
<what is done, including PR state>

## What worked
<decisions and constraints a later reader must keep>

## Next steps
<implementation steps still open; not "push", "watch CI" or "mark ready">
```

Keep it short and durable: no local paths, ports or `localhost` links. If the session already has a description, read it with `show_session` and write the full replacement. `push_branch` also accepts the literal `"none"` to leave the description as it is.

## 4. Push

Commit first. `push_branch` pushes the checkout you are in.

```js
await tools.mcp__polygraph__push_branch({ sessionId, repo: "<owner>/<name>", branch: "<branch>", description });
```

- It fails: report the tool's actual error. Offer a manual `git push` only as a question to the user.
- The remote has diverged: the tool refuses and returns the commands to integrate. `force: true` replaces the remote branch; use it only when the user says the remote should be replaced.

## 5. Pull request

Look before creating: `show_session` lists `pullRequests` (`url`, `branch`, `status`, `ci.status`). A PR for the branch exists → update it instead. A PR opened outside Polygraph → `associate_pr({ sessionId, prUrl, description })` first.

```js
await tools.mcp__polygraph__create_pr({
  sessionId, description,
  prs: [{ owner: "<owner>", repo: "<name>", title: "<title>", body: "<body>", branch: "<branch>", baseBranch: "<base>" }],
});
```

- PRs are created as drafts. Polygraph appends its own footer to the body; never write or edit that part.
- The title becomes the squash commit: follow the repo's commit convention, no agent prefix such as `[pi]`.
- A successful call can still carry a failed entry per PR. Read the result before saying a PR exists.

Then metadata, and any later change, with `update_pr`. Omitted fields stay as they are:

```js
await tools.mcp__polygraph__update_pr({ sessionId, prUrl, assignees: { mode: "add", values: ["<login>"] }, labels: { mode: "add", values: ["<label>"] } });
```

`mode: "set"` replaces the whole collection, including what people added; prefer `add` and `remove`. `body: ""` clears the body.

Finish by giving the PR URL and the session page (`polygraphSessionUrl` from `show_session`).

## 6. Ready for review

`mark_pr_ready({ sessionId, prUrls: [...] })` turns drafts into open PRs. Only when the user asks for it; it asks every time.

## 7. CI

- Status: `show_session({ sessionId })` → `pullRequests[].ci.status`, plus `hasConflicts`.
- More: `show_session({ sessionId, details: true })`. A `ci.cipeUrl` means Nx Cloud ran the pipeline: its logs live there, the URL is a page for the user and not an API, so pass it on rather than fetching it. With no `cipeUrl`, the CI entry lists the GitHub Actions runs and their jobs.
- A failed GitHub Actions job: `get_ci_logs({ sessionId, repoId, jobId })`, with `repoId` from `repositories[].id` and a numeric `jobId` from the job. It saves the log to a file and returns the path; read the part you need, logs are large. Only for finished runs.
- Do not wait for CI in a bash loop. End your turn, or arm a watch if this session has one (`until`).
