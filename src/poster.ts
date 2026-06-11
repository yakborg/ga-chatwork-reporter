const CHATWORK_API_BASE = "https://api.chatwork.com/v2";

async function postMessage(body: string, roomId: string): Promise<void> {
  const token = Deno.env.get("CHATWORK_API_TOKEN");
  if (!token) throw new Error("CHATWORK_API_TOKEN が未設定");

  const res = await fetch(`${CHATWORK_API_BASE}/rooms/${roomId}/messages`, {
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

export async function runPosterRaw(text: string, roomId: string): Promise<void> {
  await postMessage(text, roomId);
}
