import type { VercelRequest, VercelResponse } from "@vercel/node";

const GITHUB_ORG = "WaveSpeedAI";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Set CORS headers on every response
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Check for GitHub token in Authorization header
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing authorization token" });
    }

    const githubToken = authHeader.replace("Bearer ", "");

    // Verify user is a member of the WaveSpeedAI org
    const isMember = await checkOrgMembership(githubToken);
    if (!isMember) {
      return res.status(403).json({ error: "You must be a member of the WaveSpeedAI organization" });
    }

    const apiKey = process.env.WAVESPEED_UPLOAD_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Missing upload API key" });
    }

    // Get the raw body as Buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const body = Buffer.concat(chunks);

    // Get content-type header (includes boundary for multipart)
    const contentType = req.headers["content-type"];
    if (!contentType) {
      return res.status(400).json({ error: "Missing content-type" });
    }

    // Forward to WaveSpeed API
    const result = await uploadToWaveSpeed(body, contentType, apiKey);
    return res.status(200).json(result);
  } catch (e: any) {
    console.error("Upload error:", e.message);
    return res.status(500).json({ error: e.message || "Upload failed" });
  }
}

async function checkOrgMembership(token: string): Promise<boolean> {
  const username = await getUsername(token);
  if (!username) return false;

  const response = await fetch(
    `https://api.github.com/orgs/${GITHUB_ORG}/members/${username}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "WaveSpeed-CMS",
        Accept: "application/vnd.github+json",
      },
    }
  );

  // 204: User is a member
  // 302: Requester is not an org member
  // 404: User is not a member
  return response.status === 204;
}

async function getUsername(token: string): Promise<string | null> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "WaveSpeed-CMS",
        Accept: "application/vnd.github+json",
      },
    });

    if (!response.ok) return null;
    const user = await response.json();
    return user.login || null;
  } catch {
    return null;
  }
}

async function uploadToWaveSpeed(
  body: Buffer,
  contentType: string,
  apiKey: string
): Promise<{ url: string }> {
  const response = await fetch(
    "https://scheduler.wavespeed.ai/api/v1/files/upload/binary",
    {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        Authorization: `Bearer ${apiKey}`,
      },
      body: body,
    }
  );

  const data = await response.json();
  if (data.code === 200 && data.data?.full_path) {
    return { url: data.data.full_path };
  }
  throw new Error(data.message || "Upload failed");
}
