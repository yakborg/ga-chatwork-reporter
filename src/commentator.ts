// GA4 commentator — 複数期間・ディメンションのデータを集約し、Claude API で改善提案を生成する。

import Anthropic from "npm:@anthropic-ai/sdk";
import { runAnalyst, type AnalystOutput } from "./analyst.ts";
import { runPosterRaw } from "./poster.ts";

// ---- プロンプト構築 ----

function formatSummaryBlock(label: string, data: AnalystOutput): string {
  const lines: string[] = [`## ${label} (${data.period.start_date} 〜 ${data.period.end_date})`];
  const s = data.summary;

  if (s.sessions !== undefined) lines.push(`- セッション: ${Math.round(s.sessions).toLocaleString()}`);
  if (s.totalUsers !== undefined) lines.push(`- ユーザー: ${Math.round(s.totalUsers).toLocaleString()}`);
  if (s.conversions !== undefined) lines.push(`- CV: ${Math.round(s.conversions)}`);
  if (s.sessionConversionRate !== undefined) {
    lines.push(`- CVR: ${(s.sessionConversionRate * 100).toFixed(2)}%`);
  }

  for (const bd of data.breakdown) {
    const topRows = bd.rows.slice(0, 5);
    if (topRows.length === 0) continue;
    lines.push(`\n### ${bd.dimension}`);
    for (const row of topRows) {
      const sessions = typeof row.sessions === "number" ? ` sessions:${Math.round(row.sessions)}` : "";
      const cv = typeof row.conversions === "number" ? ` CV:${Math.round(row.conversions)}` : "";
      const cvr = typeof row.sessionConversionRate === "number"
        ? ` CVR:${(row.sessionConversionRate * 100).toFixed(2)}%`
        : "";
      const bounce = typeof row.bounceRate === "number"
        ? ` 直帰率:${(row.bounceRate * 100).toFixed(1)}%`
        : "";
      lines.push(`- ${row.value}:${sessions}${cv}${cvr}${bounce}`);
    }
  }

  if (data.errors.length > 0) {
    lines.push(`\n⚠ エラー: ${data.errors.join(", ")}`);
  }

  return lines.join("\n");
}

function buildPrompt(datasets: {
  overview: AnalystOutput;
  channels: AnalystOutput;
  landingPages: AnalystOutput;
  devices: AnalystOutput;
}): string {
  return `あなたはウェブ解析の専門家です。以下の GA4 データをもとに、Chatwork 投稿用の改善提案レポートを日本語で生成してください。

## 出力フォーマット（厳守）

【GA4 改善提案レポート】YYYY-MM-DD
━━━━━━━━━━━━━━
■ 現状サマリー
（昨日の主要KPIを2〜3行で要約）

■ 重要トレンド
（過去7日間の傾向で注目すべき点を箇条書き3〜5項目）

■ 改善提案（優先度順）
【緊急】タイトル
内容（具体的なアクション）

【高】タイトル
内容

【中】タイトル
内容

---

## GA4 データ

${formatSummaryBlock("昨日の概況", datasets.overview)}

${formatSummaryBlock("チャネル別（過去7日）", datasets.channels)}

${formatSummaryBlock("ランディングページ別（過去7日）", datasets.landingPages)}

${formatSummaryBlock("デバイス別（過去7日）", datasets.devices)}

---
上記データを分析し、指定フォーマットで出力してください。数値は具体的に引用し、実行可能な改善提案にしてください。`;
}

// ---- シークレット自動ロード ----

async function loadEnvFile(path: string): Promise<void> {
  try {
    const content = await Deno.readTextFile(path);
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (match && !Deno.env.get(match[1])) {
        Deno.env.set(match[1], match[2]);
      }
    }
  } catch { /* ファイルがなければスキップ */ }
}

async function loadSecrets(): Promise<void> {
  const home = Deno.env.get("HOME") ?? "/root";
  await Promise.all([
    loadEnvFile(`${home}/.secrets/env/chatwork.env`),
    loadEnvFile(`${home}/.secrets/env/anthropic.env`),
  ]);
}

// ---- メイン処理 ----

export async function runCommentator(): Promise<string> {
  const [overview, channels, landingPages, devices] = await Promise.all([
    runAnalyst("昨日の概況", "yesterday"),
    runAnalyst("チャネル別分析", "last_7_days"),
    runAnalyst("ランディングページ分析", "last_7_days"),
    runAnalyst("デバイス別分析", "last_7_days"),
  ]);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定");

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    messages: [{ role: "user", content: buildPrompt({ overview, channels, landingPages, devices }) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("テキストブロックが返されませんでした");
  return textBlock.text;
}

// ---- CLI エントリーポイント ----

async function main() {
  await loadSecrets();
  try {
    console.log("GA4 データ取得 + Claude 分析中...");
    const text = await runCommentator();
    console.log("--- 生成テキスト ---");
    console.log(text);
    await runPosterRaw(text);
    console.log("投稿完了");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}

if (import.meta.main) main();
