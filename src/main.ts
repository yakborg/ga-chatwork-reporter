import { handleWebhook } from "./webhook.ts";

Deno.serve({ port: 8000 }, async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "POST" && url.pathname === "/webhook") {
    return await handleWebhook(req);
  }
  return new Response("ok", { status: 200 });
});
