// Chatwork Webhook Bot
import Anthropic from "npm:@anthropic-ai/sdk";
import { runAnalyst } from "./analyst.ts";
import { runPosterRaw } from "./poster.ts";

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
  return body.replace(/\[To:\d+\]/g, "").trim();
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "get_ga4_data",
    description:
      "GA4からアクセス解析データを取得します。ユーザーが特定の期間や分析目的を指定した場合に使用してください。",
    input_schema: {
      type: "object" as const,
      properties: {
        purpose: {
          type: "string",
          description:
            "分析目的（例: 昨日の概況、チャネル別分析、ランディングページ分析、デバイス別分析、参照元分析）",
        },
        period: {
          type: "string",
          description:
            "期間（yesterday / last_7_days / last_week / last_30_days / last_month / YYYY-MM-DD/YYYY-MM-DD）",
        },
      },
      required: ["purpose", "period"],
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
): Promise<string> {
  if (toolName === "get_ga4_data") {
    const { purpose, period } = toolInput;
    console.log(`[webhook] get_ga4_data: purpose="${purpose}" period="${period}"`);
    const data = await runAnalyst(purpose, period);
    return JSON.stringify(data, null, 2);
  }
  if (toolName === "post_chatwork_message") {
    const { message } = toolInput;
    console.log(`[webhook] post_chatwork_message: ${message.slice(0, 80)}...`);
    await runPosterRaw(message);
    return "投稿完了";
  }
  return `未知のツール: ${toolName}`;
}

const SYSTEM_PROMPT = `あなたはGA4アクセス解析アシスタントBotです。
Chatworkのボットとして動作し、ユーザーの質問に日本語で答えます。

【行動指針】
- ユーザーの質問に応じて get_ga4_data でデータを取得し、分析してください
- 返答は必ず post_chatwork_message を呼び出してChatworkに投稿してください
- 数値は具体的に示し、簡潔にまとめてください
- データ取得エラーが発生した場合はその旨を返答に含めてください

【分析の目安】
- "昨日" → period: yesterday / "先週" → period: last_week / "先月" → period: last_month / "直近7日" → period: last_7_days
- チャネル・流入元 → purpose: チャネル別分析
- ページ・LP → purpose: ランディングページ分析
- デバイス → purpose: デバイス別分析
- それ以外 → purpose: 昨日の概況`;

async function processWebhookAsync(payload: ChatworkWebhookPayload): Promise<void> {
  const { webhook_event_type, webhook_event } = payload;
  if (webhook_event_type !== "mention_to_me") return;

  const userMessage = extractUserMessage(webhook_event.body);
  if (!userMessage) return;

  console.log(`[webhook] ユーザーメッセージ: "${userMessage}"`);

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
          await runPosterRaw(textBlock.text);
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

  (async () => {
    try {
      await processWebhookAsync(payload);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[webhook] 処理エラー:", msg);
      try {
        await runPosterRaw(`⚠ Bot エラーが発生しました\n${msg}`);
      } catch {
        // ignore
      }
    }
  })();

  return new Response("ok", { status: 200 });
}
