import { serve } from "https://deno.land/std@0.131.0/http/server.ts";

console.log('Function "telegram-file-proxy" up and running!');

const BOT_TOKEN = Deno.env.get("statistic-bot") || Deno.env.get("BOT_TOKEN") || "";

if (!BOT_TOKEN) {
  console.error('[FILE_PROXY] No bot token provided in env (statistic-bot / BOT_TOKEN)');
}

type TelegramFileResponse =
  | {
      ok: true;
      result: {
        file_id: string;
        file_unique_id: string;
        file_size?: number;
        file_path?: string;
      };
    }
  | {
      ok: false;
      description?: string;
      error_code?: number;
    };

serve(async (req: Request): Promise<Response> => {
  try {
    const url = new URL(req.url);
    const fileId = url.searchParams.get("file_id");

    if (!fileId) {
      return new Response(JSON.stringify({ error: "file_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    if (!BOT_TOKEN) {
      return new Response(JSON.stringify({ error: "Bot token is not configured" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    console.log("[FILE_PROXY] Incoming request for file_id:", fileId);

    // 1. Отримуємо file_path через getFile
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`;
    console.log("[FILE_PROXY] Calling getFile:", apiUrl);

    const fileMetaResp = await fetch(apiUrl);
    if (!fileMetaResp.ok) {
      console.error("[FILE_PROXY] getFile returned non-OK status:", fileMetaResp.status, fileMetaResp.statusText);
      const text = await fileMetaResp.text();
      console.error("[FILE_PROXY] getFile response body:", text);

      return new Response(JSON.stringify({ error: "Failed to get file metadata from Telegram" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const fileMetaJson = (await fileMetaResp.json()) as TelegramFileResponse;
    if (!fileMetaJson.ok || !("result" in fileMetaJson) || !fileMetaJson.result.file_path) {
      console.error("[FILE_PROXY] Invalid getFile response:", fileMetaJson);
      return new Response(JSON.stringify({ error: "Invalid getFile response from Telegram" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const filePath = fileMetaJson.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    console.log("[FILE_PROXY] Resolved file URL:", fileUrl);

    // 2. Проксюємо сам файл
    const fileResp = await fetch(fileUrl);
    if (!fileResp.ok || !fileResp.body) {
      console.error("[FILE_PROXY] Failed to fetch file from Telegram:", fileResp.status, fileResp.statusText);
      return new Response(JSON.stringify({ error: "Failed to download file from Telegram" }), {
        status: 502,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const contentType = fileResp.headers.get("content-type") ?? "application/octet-stream";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    console.log("[FILE_PROXY] Successfully returning file stream, content-type:", contentType);

    return new Response(fileResp.body, {
      status: 200,
      headers
    });
  } catch (err) {
    console.error("[FILE_PROXY] Unexpected error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
  }
});

