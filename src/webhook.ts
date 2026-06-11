// Chatwork Webhook Bot — ルーム別 GA プロパティ対応
import Anthropic from "npm:@anthropic-ai/sdk";
import { runAnalyst } from "./analyst.ts";
import { runPosterRaw } from "./poster.ts";
import { findTargetByRoom } from "./targets.ts";

const MAX_ITERATIONS = 10;
const MODEL = "claude-haiku-4-5-20251001";

interface ChatworkWebhookPayload {
  webhook_event_type: string;
  webhook_event: {
    from_account_id: number;
    room_id: number;
    message_id: string;
    body: string;
  };
}

function extractUserMessage(body: string): string {
  return body.replace(/\[To:\d+\]|@\S+/g, "").trim();
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_ga4_data",
    description:
      "GA4からアクセス解析データを取得します。取得したいメトリクスとディメンションを直接指定してください。",
    input_schema: {
      type: "object" as const,
      properties: {
        metrics: {
          type: "array",
          items: { type: "string" },
          description:
            "取得するGA4メトリクス名の配列。例: [\"sessions\", \"conversions\", \"sessionConversionRate\"]",
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description:
            "取得するGA4ディメンション名の配列（省略時は集計値のみ）。例: [\"landingPage\"]",
        },
        period: {
          type: "string",
          description:
            "期間（yesterday / last_7_days / last_week / last_30_days / last_month / YYYY-MM-DD/YYYY-MM-DD）",
        },
      },
      required: ["metrics", "period"],
    },
  },
  {
    name: "post_chatwork_message",
    description: "Chatworkにメッセージを投稿します。必ず1回呼び出してください。",
    input_schema: {
      type: "object" as const,
      properties: {
        message: { type: "string", description: "投稿するメッセージ本文" },
      },
      required: ["message"],
    },
  },
];

async function processToolCall(
  toolName: string,
  toolInput: Record<string, string>,
  propertyId: string,
  roomId: string,
): Promise<string> {
  if (toolName === "get_ga4_data") {
    const input = toolInput as unknown as { metrics: string[]; dimensions?: string[]; period: string };
    const { metrics, dimensions = [], period } = input;
    console.log(`[webhook] get_ga4_data: metrics=${JSON.stringify(metrics)} dimensions=${JSON.stringify(dimensions)} period="${period}" property=${propertyId}`);
    const data = await runAnalyst(metrics, dimensions, period, propertyId);
    return JSON.stringify(data, null, 2);
  }
  if (toolName === "post_chatwork_message") {
    const { message } = toolInput;
    console.log(`[webhook] post_chatwork_message room=${roomId}: ${message.slice(0, 80)}...`);
    await runPosterRaw(message, roomId);
    return "投稿完了";
  }
  return `未知のツール: ${toolName}`;
}

const SYSTEM_PROMPT = `あなたはGA4アクセス解析アシスタントBotです。
Chatworkのボットとして動作し、ユーザーの質問に日本語で答えます。

【行動指針】
- ユーザーの質問に応じて get_ga4_data でデータを取得し、分析してください
- metrics と dimensions はユーザーの質問から直接判断して指定してください
- 返答は必ず post_chatwork_message を呼び出してChatworkに投稿してください
- 数値は具体的に示し、簡潔にまとめてください
- データ取得エラーが発生した場合はその旨を返答に含めてください

【period の指定】
- "昨日" → yesterday
- "先週" → last_week
- "先月" → last_month
- "直近7日" → last_7_days
- "直近30日" → last_30_days
- 特定範囲 → YYYY-MM-DD/YYYY-MM-DD

【よく使うメトリクス (metrics)】
- sessions — セッション数
- totalUsers — ユーザー数
- newUsers — 新規ユーザー数
- screenPageViews — ページビュー数
- conversions — キーイベント数（コンバージョン数）
- sessionConversionRate — セッションCV率（%）
- bounceRate — 直帰率（%）
- engagementRate — エンゲージメント率（%）
- averageSessionDuration — 平均セッション時間（秒）
- totalRevenue — 総収益
- ecommercePurchases — EC購入数

【よく使うディメンション (dimensions)】
- sessionDefaultChannelGroup — チャネルグループ
- landingPage — ランディングページ（着地ページ）
- pagePath — ページパス
- deviceCategory — デバイスカテゴリ
- sessionSourceMedium — 参照元/メディア
- sessionSource — 参照元
- country — 国
- date — 日付

【指定例】
- 着地ページ別のキーイベント数・CV率 → metrics: ["sessions","conversions","sessionConversionRate","bounceRate"], dimensions: ["landingPage"]
- チャネル別のセッション・CV → metrics: ["sessions","conversions","sessionConversionRate"], dimensions: ["sessionDefaultChannelGroup"]
- 昨日の概況 → metrics: ["sessions","totalUsers","newUsers","conversions","sessionConversionRate"], dimensions: []`;

async function processWebhookAsync(payload: ChatworkWebhookPayload): Promise<void> {
  const { webhook_event_type, webhook_event } = payload;
  if (webhook_event_type !== "message_created") return;
  if (!webhook_event.body.includes("@")) return;

  const roomId = String(webhook_event.room_id);
  const target = findTargetByRoom(roomId);
  if (!target) {
    console.log(`[webhook] 未登録ルーム: ${roomId} — 無視`);
    return;
  }

  const userMessage = extractUserMessage(webhook_event.body);
  if (!userMessage) return;

  console.log(`[webhook] room=${roomId} property=${target.propertyId} msg="${userMessage}"`);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定");

  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
  let posted = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    console.log(`[webhook] ループ ${i + 1}: stop_reason=${response.stop_reason}`);
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "end_turn") {
      if (!posted) {
        const textBlock = response.content.find((b) => b.type === "text");
        if (textBlock && textBlock.type === "text" && textBlock.text.trim()) {
          await runPosterRaw(textBlock.text, roomId);
        }
      }
      break;
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.type !== "tool_use") continue;
        const result = await processToolCall(
          block.name,
          block.input as Record<string, string>,
          target.propertyId,
          roomId,
        );
        toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        if (block.name === "post_chatwork_message") posted = true;
      }

      messages.push({ role: "user", content: toolResults });
      if (posted) break;
    }
  }
}

export async function handleWebhook(req: Request): Promise<Response> {
  let payload: ChatworkWebhookPayload;
  try {
    payload = await req.json() as ChatworkWebhookPayload;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const roomId = String(payload.webhook_event?.room_id ?? "");

  (async () => {
    try {
      await processWebhookAsync(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[webhook] 処理エラー:", msg);
      if (roomId && findTargetByRoom(roomId)) {
        try {
          await runPosterRaw(`⚠ Bot エラーが発生しました\n${msg}`, roomId);
        } catch {
          // ignore
        }
      }
    }
  })();

  return new Response("ok", { status: 200 });
}
