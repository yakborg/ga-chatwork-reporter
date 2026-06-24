# Agent Notes

## SSH and Git Push

- GitHub remote uses SSH: `git@github.com:yakborg/ga-chatwork-reporter.git`.
- `git push` may fail in agent sessions if `SSH_AUTH_SOCK` is not inherited, even when the user is authenticated in their terminal.
- Before pushing, prefer checking:
  - `echo "$SSH_AUTH_SOCK"`
  - `ssh-add -l`
  - `ssh -T git@github.com`
- If the user's terminal has a working agent socket but the current agent session does not, reuse the socket explicitly for push:
  - `SSH_AUTH_SOCK=/tmp/.../agent.xxx git push origin main`
- The user's shell/tmux config was updated to make this more reliable across Claude Code and Codex:
  - `~/.zshrc`
  - `~/.ssh/config`
  - `~/.tmux.conf`

## Startup Guidance

- Prefer starting Claude Code or Codex from the same interactive shell where `ssh-add -l` succeeds.
- If running inside `tmux`, open a fresh pane/window after shell startup so the latest `SSH_AUTH_SOCK` is propagated.

## Logs

- Agent logs directory: `~/.local/state/ai-agents`
- Optional wrappers available in the user's shell:
  - `claude_log`
  - `codex_log`

## Recent Change

- `src/webhook.ts` was updated so `processWebhookAsync` now handles `message_created` events and only proceeds when `webhook_event.body` includes `[To:`.
