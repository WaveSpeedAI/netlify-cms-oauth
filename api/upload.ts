import { IncomingMessage, ServerResponse } from "http";
import https from "https";

const GITHUB_ORG = "WaveSpeedAI";

export default async (req: IncomingMessage, res: ServerResponse) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

  // Check for GitHub token in Authorization header
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.statusCode = 401;
    res.end(JSON.stringify({ error: "Missing authorization token" }));
    return;
  }

  const githubToken = authHeader.replace("Bearer ", "");

  // Verify user is a member of the WaveSpeedAI org
  const isMember = await checkOrgMembership(githubToken);
  if (!isMember) {
    res.statusCode = 403;
    res.end(JSON.stringify({ error: "You must be a member of the WaveSpeedAI organization" }));
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

async function checkOrgMembership(token: string): Promise<boolean> {
  // First get the authenticated user's username
  const username = await getUsername(token);
  if (!username) return false;

  // Check if user is a member of the org
  // https://docs.github.com/en/rest/orgs/members#check-organization-membership-for-a-user
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: `/orgs/${GITHUB_ORG}/members/${username}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "WaveSpeed-CMS",
          Accept: "application/vnd.github+json",
        },
      },
      (response) => {
        // 204: User is a member
        // 302: Requester is not an org member
        // 404: User is not a member
        resolve(response.statusCode === 204);
      }
    );
    req.on("error", () => resolve(false));
    req.end();
  });
}

function getUsername(token: string): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: "/user",
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "WaveSpeed-CMS",
          Accept: "application/vnd.github+json",
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            const user = JSON.parse(data);
            resolve(user.login || null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.end();
  });
}

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
