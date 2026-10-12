# pi-polygraph

Polygraph for [Pi](https://pi.dev): lets a Pi session ship through Polygraph the way a Claude Code session does with the Polygraph plugin. Push a branch, open and update pull requests, mark them ready, read CI status and logs.

The tools are Polygraph's own MCP server, `@polygraph/mcp`. This package adds the three things an MCP server cannot do for itself in Pi:

- **A confirmation before anything that changes something.** The server declares no read-only hints, so the extension keeps the list.
- **A session binding.** Which Polygraph session this Pi session ships to, kept across compaction, reload and resume.
- **A skill**, `polygraph-ship`, that walks the model through the flow with the exact tool names.

Built and checked against Pi 1.1.0, `@polygraph/mcp` 0.3.1 and Polygraph CLI 2610.12.

Unofficial: this is not an Nx product. It builds on Nx's `@polygraph/mcp` server and `polygraph` CLI.

## Requirements

- The `polygraph` CLI on `PATH`, logged in with an organization selected (`polygraph auth login`, `polygraph whoami --json`). The MCP server runs the CLI for every tool.
- `npx`, to start the server.
- Pi's built-in `mcp` and `codemode` extensions (on by default).

## Use it

Install it for every session (this adds the source to `~/.pi/agent/settings.json`):

```bash
pi install git:github.com/nartc/pi-polygraph
```

Or work from a checkout. Try it for one run without installing:

```bash
pi -e /path/to/pi-polygraph
```

Install the checkout itself, which is loaded in place, not copied:

```bash
pi install /path/to/pi-polygraph
```

The extension registers the MCP server itself, as `polygraph`, so no `mcp.json` entry is needed. If `mcp.json` has a server named `polygraph` (for example from `pi mcp add polygraph -- npx -y @polygraph/mcp@latest`), Pi uses that one and `/mcp` shows the registration as overridden; the tools and the confirmations are the same either way. A server under another name is not covered, except `polygraph-mcp`.

Tools are `mcp__polygraph__<tool>`, reached through `codemode`.

## Confirmations

| Call | What happens |
|---|---|
| `whoami`, `list_accounts`, `list_repos`, `list_sessions`, `search_sessions`, `show_session`, `session_intro`, `get_session_logs`, `list_artifacts`, `show_agent`, `get_ci_logs`, `git_fetch` | Runs. |
| `push_branch` (no `force`), `create_pr`, `update_pr`, `associate_pr` | Asks: **Yes, once** / **Yes, and stop asking … for this Polygraph session** / **No**. |
| Everything else, including `push_branch` with `force`, `mark_pr_ready`, `start_session`, `archive_session`, artifacts, agents, login and account tools, and any tool added upstream later | Asks every time: **Yes, once** / **No**. |

- The dialog names what would be published (repo, branch, PR titles, URLs, the session) and leaves out long prose such as PR bodies and session descriptions. It says so when the call targets a session other than the bound one.
- "Stop asking" lasts until Pi restarts, reloads or moves in the session tree, and covers one Polygraph session id.
- No interactive UI (print or JSON mode, a subagent): the call is refused, not run.
- Escape, or No: the call is blocked and the model is told not to retry or publish another way.

The dialog opens in the Pi window that made the call. For a worker in a background tmux window, that is where it waits.

This is a guard rail for the Polygraph tools, not a sandbox: `git push` or `polygraph git push-branch` typed into bash does not pass through it.

## Binding

A Pi session becomes bound to a Polygraph session when:

- it starts one (`start_session` succeeds), or
- it is unbound and a push or pull request call succeeds, or
- you run `/polygraph bind <session id or URL>`, which checks the session with a read-only `polygraph session show` first.

While bound, the footer shows `polygraph <id>` and the system prompt carries a `polygraph_session` section with the id, rebuilt every run, which is what survives compaction. The binding is a Pi custom entry (`polygraph-binding`) on the active branch of the session tree: resume and reload bring it back, `/tree` follows the branch, and a fork or clone starts unbound. Nothing about it is sent to Polygraph.

| Command | |
|---|---|
| `/polygraph` or `/polygraph status` | Show the binding. |
| `/polygraph bind <session id or URL>` | Bind after checking the session exists. |
| `/polygraph unbind` | Remove the local binding. The Polygraph session is untouched. |

## Development

```bash
npm install
npm run check
```

`npm run check` typechecks against the Pi extension types and runs the tests. None of them reach Polygraph:

- `test/tools.test.ts`, `test/binding.test.ts`: the pure parts.
- `test/extension.test.ts`: the extension loaded into a fake Pi session (`test/helpers/fake-pi.ts`): the gate, session grants, binding, restart, the command.
- `test/mcp-contract.test.ts`: the real `@polygraph/mcp` server driven over stdio against a fake CLI (`test/fixtures/fake-polygraph.mjs`), with an empty `HOME`. It fails when the server gains or loses a tool, and checks the CLI commands the publishing tools turn into.

The server honours `POLYGRAPH_CLI`, so the same fake works for a live run in Pi:

```bash
POLYGRAPH_CLI=$PWD/test/fixtures/fake-polygraph.mjs FAKE_POLYGRAPH_LOG=/tmp/cli.log pi -e .
```

## What it does not do

- **Transcript capture and conversation linking.** The CLI learns the calling harness from environment variables and does not read Pi's, so a session started from Pi is recorded with the CLI's default harness (`claude`) and no conversation id, and `polygraph session resume` cannot reopen a Pi conversation. The CLI does accept `pi` on its internal `_link-agent-session` command; nothing here calls it.
- **Child agents.** `spawn_agent` starts claude, codex, opencode or cursor children, not Pi ones, and pi-subagents children do not carry MCP tools.
- **The rest of the Polygraph plugin's skills** (session start, awaiting CI, pack-and-copy, debrief, adversarial review).
- **Real publishing in tests.** Pushing, PR creation and the rest have only ever run against the fake CLI.

One thing to know: if Pi is started from a shell that carries `CLAUDE_CODE_SESSION_ID` (a tmux server first launched inside Claude Code, say), the CLI will attribute Polygraph calls to that Claude session.
