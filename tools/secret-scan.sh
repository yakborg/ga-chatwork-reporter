#!/usr/bin/env bash
# 秘匿ゲート本体。pre-commit（staged）と pre-push（range）の両方から呼ぶ。
# 実行系は WSL のみ。
#
# このリポジトリは **公開** なので、ゲートは push 自動化のためではなく漏洩防止のために置く。
# 許可形（allowlist）は private リポジトリより狭くする。
#
# 原則:
#   - 検査対象は「追加行」と追加/変更後のファイル名のみ。削除行・削除されたファイル名を
#     含めると、漏洩値やファイル名を除去する commit 自体が恒常的にブロックされる
#   - 実値は列挙しない。構造的検出＋許可形の allowlist。構造的に書けない固有名詞は
#     ~/.secrets/gate-patterns（追跡下に置かないローカルの正本）へ分離する
#   - 一致した文字列もパターン本文もログへ出さない
#   - git・grep の失敗、設定の欠落、不正なパターンは「検査なしで通過」にしない（fail-closed）
#
# 使い方: secret-scan.sh staged
#         secret-scan.sh range <from> <to>
set -uo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel) || exit 1
cd "$REPO_ROOT" || exit 1

# 禁止パターンの正本は追跡下に置かないローカルファイル 1 本。repo ごとに一覧を持つと
# 集合が分岐し「この repo だけ検査していない値」が静かにできる。
# ext4・600 に置く（DrvFs 上では mode が効かないため正本にしない）。
PAT_FILE="$HOME/.secrets/gate-patterns"
CONFIG="tools/gitleaks.toml"
# 追加行の目印。既定の '+' だと、本文が '++' で始まる追加行が diff ヘッダー（+++）と
# 区別できず取りこぼす。衝突しない 1 文字へ差し替える。
MARK='>'
bad=0

die()   { printf 'secret-gate: BLOCK: %s\n' "$1" >&2; bad=1; }
abort() { printf 'secret-gate: BLOCK: %s\nsecret-gate: ABORT\n' "$1" >&2; exit 1; }

# grep は 0=一致 / 1=不一致 / 2 以上=grep 自体のエラー。エラーを「不一致」と同一視すると
# 検査を素通りするため、2 以上は fail-closed に倒す。
grep_rc() { # $1=説明 $2=rc → 一致なら 0 を返す
  case "$2" in
    0) return 0 ;;
    1) return 1 ;;
    *) die "$1 の検査で grep がエラー終了した（exit $2）"; return 1 ;;
  esac
}

mode=${1:-}
ncommit=0

case "$mode" in
  staged)
    raw=$(git diff --cached --text -U0 --output-indicator-new="$MARK") ||
      abort "git diff --cached に失敗した"
    # 削除以外（--diff-filter=d = D を除く全 status）のファイル名を見る。ACMR だと type change(T) が
    # 抜ける。削除だけを外すのがこのゲートの原則（禁止名を消す commit を止めない）に一致する。
    # core.quotePath=false: 非 ASCII を C クオートさせない（日本語ファイル名が掛からなくなる）
    names=$(git -c core.quotePath=false diff --cached --name-only --diff-filter=d) ||
      abort "git diff --cached --name-only に失敗した"
    blobs=$(git diff --cached --raw --no-abbrev --diff-filter=d | awk '/^:/ {print $4}' | sort -u) ||
      abort "staged blob の一覧を取得できない"
    ;;
  range)
    from=${2:-}; to=${3:-}
    [ -n "$from" ] && [ -n "$to" ] || abort "range には <from> <to> が要る"
    ncommit=$(git rev-list --count "$from..$to") ||
      abort "送出 commit 数を数えられない（$from..$to が解決できない）。git fetch --prune 後に再実行する"
    # 2 点間の net diff では見落とす: ある commit で追加し後続 commit で削除した行は
    # 差分に出ないが、push すれば履歴には残る。commit ごとの patch を見る。
    # -m はマージ commit の差分も各親に対して出す（重複するが取りこぼさない側に倒す）。
    raw=$(git log -p -U0 -m --text --format='' --output-indicator-new="$MARK" "$from..$to") ||
      abort "git log -p に失敗した（$from..$to）"
    names=$(git -c core.quotePath=false log --name-only -m --format='' --diff-filter=d "$from..$to" | sort -u) ||
      abort "git log --name-only に失敗した（$from..$to）"
    blobs=$(git log -m --raw --no-abbrev --format='' --diff-filter=d "$from..$to" | awk '/^:/ {print $4}' | sort -u) ||
      abort "range blob の一覧を取得できない（$from..$to）"
    ;;
  *)
    echo "usage: secret-scan.sh staged | range <from> <to>" >&2
    exit 2
    ;;
esac

added=$(grep "^$MARK" <<<"$raw"); grep_rc "追加行の抽出" $? || true
scan="${added}
${names}"

# staged で何も無いのは正常（検査対象が無い）。range は送出 commit がある限り必ず
# 決定論スキャナまで走らせる（追加行が空でも履歴には commit が乗るため）。
if [ -z "${scan//[[:space:]]/}" ] && [ "$ncommit" -eq 0 ]; then
  echo "secret-gate: 検査対象なし ($mode)"
  exit 0
fi

# --- (a) メールアドレス: 構造で拾い、許可形以外を落とす -----------------------
# 実アドレスをゲートへ登録して通す運用はしない（列挙は網羅を保証できず、登録漏れが素通しする）。
# **公開リポジトリなので許可は RFC 2606 の予約ドメインだけ**に絞る。gmail 等の独自
# placeholder は通さない。どうしても必要になったら README に根拠を書いてから足す。
# 新しい許可形は tools/gitleaks.toml にも足す（片方だけだと どちらかで落ちる）。
# 半角/全角の ＠ を両方拾う。
EMAIL_RE='[A-Za-z0-9._%+-]+(@|＠)[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
# git@github.com は個人アドレスではなく SSH の固定 URL（clone 手順に必ず出る）。
# 完全一致（^...$）で通す。後ろに別ドメインが続く形（git@github.com.<別ドメイン>）は落ちる。
EMAIL_ALLOW_RE='(@|＠)example\.(com|org|net)$|\.(example|test|invalid|localhost)$|^git(@|＠)github\.com$'
emails=$(grep -oE "$EMAIL_RE" <<<"$scan"); grep_rc "メール抽出" $? || true
if [ -n "$emails" ]; then
  n=$(grep -cvE "$EMAIL_ALLOW_RE" <<<"$emails"); grep_rc "メール allowlist 判定" $? || true
  [ "${n:-0}" -gt 0 ] &&
    die "placeholder 以外のメールアドレス ${n} 件（値は出力しない。位置は gitleaks 出力か対象ファイル名を参照）"
fi

# --- (b) 構造的に書ける秘匿値 --------------------------------------------------
# 桁数だけで拾える**数値 ID（room ID / account ID 等）は構造式にしない**。
# 誤検知でゲートが運用不能になり、外す圧力に直結する。絶対に出てはいけない具体値だけを
# ~/.secrets/gate-patterns へ足して (c) で捕まえる。
grep -qiE '\.apps\.googleuserconten[t]\.com' <<<"$scan"
grep_rc "OAuth client_id suffix" $? && die "OAuth client_id の suffix"

# Google OAuth の client_secret は GOCSPX 接頭辞（直後にハイフン）を持つ。gitleaks の
# 既定ルールは変数名を付けても拾わない（2026-08-07 実測）。構造式セットの必須項目。
grep -qE 'GOCSP[X]-' <<<"$scan"
grep_rc "Google OAuth client_secret" $? && die "Google OAuth の client_secret（GOCSPX 接頭辞）"

# Chatwork API トークン = 32 桁の小文字 hex。gitleaks の既定ルールは変数名の文脈が
# 無いと拾わないため（地の文への貼り付け・引用符付きのコード例が素通しする。2026-08-07 実測）、
# 構造式をここに置く。
# GA4 のサービスアカウントキー（private_key の PEM を含む JSON）は gitleaks の既定ルールが
# 文脈なしで検出するため、ここには重複して置かない（(e) の決定論スキャナが受け持つ）。
grep -qE '\b[0-9a-f]{32}\b' <<<"$scan"
grep_rc "Chatwork API トークン形" $? && die "32 桁 hex（Chatwork API トークン形）"

# --- (c) ローカル秘匿パターン（構造的に書けない固有名詞・具体値） ----------------
# 実値は追跡下に置かない。欠落・権限過大・0 件・不正 regex はすべて fail-closed。
#
# git 経路の漏洩は mode bit では塞げない。`git add -f` 一回で追跡下に入れば、以後は
# 普通に commit される。正本が repo の外にある場合はこの経路自体が成立しないので、
# repo 内にある時（将来の repo ローカル例外リスト等）だけ確認する。
case "$PAT_FILE" in
  "$REPO_ROOT"/*)
    git ls-files --error-unmatch -- "$PAT_FILE" >/dev/null 2>&1
    case $? in
      0) die "$PAT_FILE が git の追跡下にある（ローカル秘匿パターンを追跡下に置かない）" ;;
      1) ;;
      *) die "$PAT_FILE の追跡状態を確認できない" ;;
    esac
    git check-ignore -q -- "$PAT_FILE"
    case $? in
      0) ;;
      1) die "$PAT_FILE が .gitignore で無視されていない（誤って commit されうる）" ;;
      *) die "$PAT_FILE の ignore 状態を確認できない" ;;
    esac
    ;;
esac

if [ ! -r "$PAT_FILE" ]; then
  die "$PAT_FILE が無い/読めない（ゲートが不完全）。tools/gate-patterns.example から作る"
else
  perm=$(stat -c '%a' "$PAT_FILE" 2>/dev/null) || perm=""
  case "$perm" in
    600|400) ;;
    *) die "$PAT_FILE の権限が ${perm:-不明}（600 にする）" ;;
  esac
  npat=0
  while IFS= read -r pat || [ -n "$pat" ]; do
    # 正本の表現差でパターンが無効化されないようにする。行末 CR は全パターンを、
    # 先頭 BOM は 1 件目だけを黙らせる（BOM 付きコメント行はパターン扱いにもなる）。
    # どちらも Windows 側エディタで正本を保存した瞬間に入り、3 repo が同時に効きを失う。
    pat=${pat%$'\r'}   # Windows 側エディタで編集された場合の CRLF 対策
    pat=${pat#$'\xef\xbb\xbf'}
    case "$pat" in ''|\#*) continue ;; esac
    [ -z "${pat//[[:space:]]/}" ] && continue
    npat=$((npat + 1))
    grep -qiE -- "$pat" <<<"$scan"
    case $? in
      0) die "ローカル秘匿パターンに一致（パターン本文・一致文字列は表示しない）" ;;
      1) ;;
      *) die "ローカル秘匿パターン ${npat} 件目が正規表現として不正（本文は表示しない）" ;;
    esac
  done < "$PAT_FILE"
  [ "$npat" -gt 0 ] || die "$PAT_FILE に有効なパターンが 1 件も無い（ゲートが不完全）"
fi

# --- (d) NUL バイトを含む blob ------------------------------------------------
# UTF-16 等は上の文字列走査をすり抜ける。UTF-16LE の .ps1 は .gitattributes の
# working-tree-encoding で UTF-8 化してから commit する。
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  case "$sha" in *[!0-9a-f]*) continue ;; esac
  [ -z "${sha//0/}" ] && continue
  if git cat-file blob "$sha" 2>/dev/null | head -c 8192 | od -An -tx1 | grep -q ' 00'; then
    die "NUL バイトを含む blob がある（UTF-16? .gitattributes の working-tree-encoding を設定）"
  fi
done <<<"$blobs"

# --- (e) 決定論スキャナ。解決できなければ止める -------------------------------
GITLEAKS=$(command -v gitleaks) || GITLEAKS=""
[ -z "$GITLEAKS" ] && [ -x "$HOME/.local/share/mise/shims/gitleaks" ] && GITLEAKS="$HOME/.local/share/mise/shims/gitleaks"
if [ -z "$GITLEAKS" ]; then
  die "gitleaks を解決できない（未導入）。fail-closed で中止する"
elif [ ! -r "$CONFIG" ]; then
  die "$CONFIG が無い/読めない。fail-closed で中止する"
else
  # --ignore-gitleaks-allow: 追加行に gitleaks:allow を添えるだけで検出を抑止できる穴を塞ぐ
  case "$mode" in
    staged) "$GITLEAKS" git --pre-commit --staged --config "$CONFIG" \
              --redact --no-banner --ignore-gitleaks-allow || bad=1 ;;
    range)  "$GITLEAKS" git --log-opts="$from..$to" --config "$CONFIG" \
              --redact --no-banner --ignore-gitleaks-allow || bad=1 ;;
  esac
fi

if [ "$bad" -ne 0 ]; then
  echo "secret-gate: ABORT ($mode)" >&2
  exit 1
fi
echo "secret-gate: CLEAN ($mode, commits=$ncommit)"
exit 0
