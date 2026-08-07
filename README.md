GA Chatwork Reporter

## 秘匿ゲートの有効化（clone 後に必ず）

**このリポジトリは公開です。ゲートは push 自動化のためではなく、漏洩防止のために入れています。**
Chatwork API トークン・GA4 サービスアカウントキー・Anthropic API キーを扱うため、値が commit に
混ざったまま push されると、履歴を書き換えても fork・既存 clone・各種キャッシュには残り、
実質的に取り消せません。

`core.hooksPath` は clone に付いてこないので、clone のたびに設定が要ります。

```bash
git config core.hooksPath tools/hooks
install -m 600 tools/gate-patterns.example ~/.secrets/gate-patterns  # 具体値を追記
```

- pre-commit は staged の追加行とファイル名を、pre-push は送出する commit すべての追加行を検査します
- 検出は構造で行います（メール形・32 桁 hex の API トークン形・OAuth client_id）。
  サービスアカウントキーの `private_key` は gitleaks の既定ルールが受け持ちます
- 許可するのは RFC 2606 の予約ドメイン（`example.com` / `.org` / `.net` / `.test` など）だけです。
  独自の placeholder を通したい場合は、根拠をこの README に書いてから許可リストへ足してください
- 許可リストに入れている例外は現在 1 つだけです。**`git@github.com`** — clone 手順に必ず出る
  SSH の固定 URL で、個人アドレスではありません。完全一致でのみ通すので、
  `git@github.com.<別ドメイン>` のように後ろに何か付いた形は落ちます
- 数値 ID（GA4 property ID・Chatwork room ID）は桁数で検出しません。誤検知でゲートが使えなく
  なるためです。絶対に出てはいけない具体値は `~/.secrets/gate-patterns` に足してください
  （リポジトリには置きません）
- `~/.secrets/gate-patterns` が無い・権限が緩い・有効なパターンが 0 件のいずれでも、
  ゲートは commit と push を止めます（検査できないまま通さない）

### ゲート導入前の履歴スキャン（2026-08-07）

ゲートを入れる前に既存履歴を 1 回スキャンし、**3 種いずれも 0 件**でした。
「何を見て、何を見ていないか」まで残します（0 件だけだと「何も無いことが証明済み」と
読まれ、再確認の要否を判断できないため）。

- **対象範囲**: 全 ref・全履歴（追加行と**削除行の両方**）・ファイル名（2 ref / 14 commit 時点）
- **1. gitleaks の既定ルール**（資格情報系: API キー・トークン・秘密鍵） → 0 件
- **2. 構造式**（メール形。RFC 2606 の予約ドメイン・予約 TLD と `git@github.com` を除外） → 0 件
- **3. 共通正本の和集合**（構造的に書けない固有名詞。`~/.secrets/gate-patterns`） → 0 件
- **範囲外**: GCP project-id・MCC・advertiser ID。これらは client 識別子であって秘匿値では
  なく、上記のどれも対象にしていません。混入の有無はこのスキャンからは言えません
- 検出器が壊れていないことは対照で確認済み（パターンから生成した literal 10 件が 10 件とも検出）
- ローカル未 fetch の GitHub 側 ref・fork は範囲外
