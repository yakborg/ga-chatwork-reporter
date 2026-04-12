// Deno Deploy エントリーポイント — 毎朝 9:00 JST に GA4 日次レポートを Chatwork へ投稿する。
import { runAnalyst } from "./analyst.ts";
import { runPoster } from "./poster.ts";
import { handleWebhook } from "./webhook.ts";

Deno.serve({ port: 8000 }, async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/webhook") {
    return await handleWebhook(req);
  }
  return new Response("ok", { status: 200 });
});

Deno.cron("daily-ga4-report", "0 0 * * *", async () => {
  console.log("GA4 日次レポート送信開始");
  const data = await runAnalyst("昨日の概況", "yesterday");
  if (data.errors.length > 0) console.error("analyst エラー:", data.errors);
  await runPoster(data);
  console.log("完了");
});
