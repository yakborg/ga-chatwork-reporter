# ga-chatwork-reporter handoff

## Project

- Repo: `/home/noda/dev/ga-chatwork-reporter`
- Git remote: `git@github.com:yakborg/ga-chatwork-reporter.git`
- Main branch was updated and pushed on 2026-04-13 JST.

## Recent Work

- `src/webhook.ts` の `processWebhookAsync` を修正した。
- 変更前:
  - `if (webhook_event_type !== "mention_to_me") return;`
- 変更後:
  - `if (webhook_event_type !== "message_created") return;`
  - `if (!webhook_event.body.includes("[To:")) return;`
- 検証:
  - `bashdeno` は環境に無かったため、代わりに `deno check src/main.ts` を実行して通過。
- Commit / push:
  - commit: `f43bd23`
  - message: `fix: handle message_created event instead of mention_to_me`
  - `origin/main` へ push 済み

## SSH / Push Notes

- ユーザー端末では GitHub SSH 認証は有効。
- エージェント側で `git push` が失敗する原因は、`SSH_AUTH_SOCK` がセッションに継承されないこと。
- ユーザー端末で確認済み:
  - `ssh-add -l` 成功
  - `ssh -T git@github.com` 成功
- エージェント内で push が失敗した場合は、まず以下を確認する:
  - `echo "$SSH_AUTH_SOCK"`
  - `ssh-add -l`
  - `ssh -T git@github.com`
- ユーザー端末に有効な agent socket があり、エージェント側に継承されていないだけなら明示指定で回避できる:
  - `SSH_AUTH_SOCK=/tmp/.../agent.xxx git push origin main`

## Shell / tmux Hardening

- 2026-04-13 に以下を更新済み:
  - `~/.zshrc`
  - `~/.ssh/config`
  - `~/.tmux.conf`
- 目的:
  - Claude Code / Codex の両方で SSH agent 継承を安定化
  - tmux が古い `SSH_AUTH_SOCK` を保持し続ける問題を減らす
- `.zshrc` に追加済み:
  - `AI_AGENT_LOG_DIR=~/.local/state/ai-agents`
  - `agent_doctor`
  - `claude_log`
  - `codex_log`
- tmux 利用時は、新しい pane/window を開いて `SSH_AUTH_SOCK` を反映させる。

## AI Policy Notes

- `/home/noda/ai-policy` は Claude / Codex 共通の運用リポジトリ。
- repo 外の `ai-policy` は自動では参照されないことがある。
- このため、継続したい重要事項は repo 内 `AGENTS.md` にも残す方が安全。
- この repo には `/home/noda/dev/ga-chatwork-reporter/AGENTS.md` を追加済み。

## Next Session Guidance

- 作業開始時に読む候補:
  - `/home/noda/dev/ga-chatwork-reporter/HANDOFF.md`（本ファイル）
  - `/home/noda/dev/ga-chatwork-reporter/AGENTS.md`
- push が必要なときは、まず通常の `git push` を試す前に `SSH_AUTH_SOCK` の有無を確認する。
- `bashdeno` が無い環境では `deno check src/main.ts` を使う。
