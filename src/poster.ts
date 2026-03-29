// Chatwork poster — analyst.ts の JSON を stdin から受け取り、Chatwork に投稿する。

import type { AnalystOutput, BreakdownRow } from "./analyst.ts";

const ROOM_ID = "427668350";
const CHATWORK_API_BASE = "https://api.chatwork.com/v2";

// ---- フォーマット ----

function fmt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

const DIMENSION_LABELS: Record<string, string> = {
  sessionDefaultChannelGroup: "チャネル別",
  sessionSourceMedium: "参照元/メディア別",
  pagePath: "ページ別",
  deviceCategory: "デバイス別",
  eventName: "イベント別",
  country: "国別",
};

function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension] ?? dimension;
}

function formatBreakdownRow(row: BreakdownRow): string {
  const sessions = typeof row.sessions === "number" ? fmt(row.sessions) : null;
  const cv = typeof row.conversions === "number" ? Math.round(row.conversions) : null;

  if (sessions !== null && cv !== null) {
    return `${row.value}: ${sessions} / CV ${cv}`;
  }
  if (sessions !== null) return `${row.value}: ${sessions}`;
  return row.value;
}

function formatMessage(data: AnalystOutput): string {
  const lines: string[] = [];
  const sep = "━━━━━━━━━━━━━━";
  const s = data.summary;

  lines.push(`【GA4日次レポート】${data.period.start_date}`);
  lines.push(sep);

  if (s.sessions !== undefined) {
    lines.push(`セッション: ${fmt(s.sessions)}`);
  }
  if (s.totalUsers !== undefined) {
    const newPart = s.newUsers !== undefined ? `（新規 ${fmt(s.newUsers)}）` : "";
    lines.push(`ユーザー: ${fmt(s.totalUsers)}${newPart}`);
  }
  if (s.conversions !== undefined) {
    const cvrPart = s.sessionConversionRate !== undefined
      ? ` / CVR: ${(s.sessionConversionRate * 100).toFixed(2)}%`
      : "";
    lines.push(`CV: ${fmt(s.conversions)}件${cvrPart}`);
  }

  // breakdown ブロック（あれば展開、なければ省略）
  for (const bd of data.breakdown) {
    const topRows = bd.rows.slice(0, 5);
    if (topRows.length === 0) continue;
    lines.push(sep);
    lines.push(`${dimensionLabel(bd.dimension)}（上位${topRows.length}件）`);
    for (const row of topRows) {
      lines.push(formatBreakdownRow(row));
    }
  }

  // エラー
  for (const err of data.errors) {
    lines.push(`⚠ ${err}`);
  }

  return lines.join("\n");
}

// ---- Chatwork 投稿 ----

async function postMessage(body: string): Promise<void> {
  const token = Deno.env.get("CHATWORK_API_TOKEN");
  if (!token) throw new Error("CHATWORK_API_TOKEN が未設定");

  const res = await fetch(`${CHATWORK_API_BASE}/rooms/${ROOM_ID}/messages`, {
    method: "POST",
    headers: {
      "X-ChatWorkToken": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ body }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chatwork API エラー: ${res.status} ${text}`);
  }
}

// ---- エクスポート関数 ----

export async function runPoster(data: AnalystOutput): Promise<void> {
  await postMessage(formatMessage(data));
}

// ---- CLI エントリーポイント ----

async function main() {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) {
    chunks.push(chunk);
  }
  const raw = new TextDecoder().decode(
    chunks.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; }, new Uint8Array()),
  );

  let data: AnalystOutput;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("stdin の JSON パースに失敗しました");
    Deno.exit(1);
  }

  try {
    await runPoster(data);
    console.log("投稿完了");
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    Deno.exit(1);
  }
}

if (import.meta.main) main();
