import { IncomingMessage, ServerResponse } from "http";
import https from "https";

export default async (req: IncomingMessage, res: ServerResponse) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const apiKey = process.env.WAVESPEED_UPLOAD_API_KEY;
  if (!apiKey) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "Missing upload API key" }));
    return;
  }

  try {
    // Collect incoming request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    // Get content-type header (includes boundary for multipart)
    const contentType = req.headers["content-type"];
    if (!contentType) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "Missing content-type" }));
      return;
    }

    // Forward to WaveSpeed API
    const result = await uploadToWaveSpeed(body, contentType, apiKey);

    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (e: any) {
    console.error("Upload error:", e.message);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: e.message }));
  }
};

function uploadToWaveSpeed(
  body: Buffer,
  contentType: string,
  apiKey: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "scheduler.wavespeed.ai",
        path: "/api/v1/files/upload/binary",
        method: "POST",
        headers: {
          "Content-Type": contentType,
          "Content-Length": body.length,
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code === 200 && parsed.data?.full_path) {
              resolve({ url: parsed.data.full_path });
            } else {
              reject(new Error(parsed.message || "Upload failed"));
            }
          } catch {
            reject(new Error("Invalid response from upload API"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
