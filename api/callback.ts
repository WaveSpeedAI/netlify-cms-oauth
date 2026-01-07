import { IncomingMessage, ServerResponse } from "http";
import https from "https";

// Cache to prevent duplicate token exchanges (codes are single-use)
const usedCodes = new Map<string, { token: string; timestamp: number }>();

// Clean old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [code, data] of usedCodes) {
    if (now - data.timestamp > 5 * 60 * 1000) {
      usedCodes.delete(code);
    }
  }
}, 60 * 1000);

export default async (req: IncomingMessage, res: ServerResponse) => {
  const { host } = req.headers;
  const url = new URL(`https://${host}/${req.url}`);
  const code = url.searchParams.get("code");
  const provider = "github";

  const client_id = process.env.OAUTH_GITHUB_CLIENT_ID;
  const client_secret = process.env.OAUTH_GITHUB_CLIENT_SECRET;

  try {
    if (!code) throw new Error("Missing code");
    if (!client_id || !client_secret) throw new Error("Missing credentials");

    // Return cached token for duplicate requests
    const cached = usedCodes.get(code);
    if (cached) {
      return sendSuccess(res, provider, cached.token);
    }

    // Exchange code for token
    const postData = `client_id=${client_id}&client_secret=${client_secret}&code=${code}`;
    const tokenData = await exchangeToken(postData);

    if (tokenData.error) {
      throw new Error(`GitHub: ${tokenData.error} - ${tokenData.error_description}`);
    }

    const token = tokenData.access_token;
    if (!token) {
      throw new Error("No access_token in response");
    }

    // Cache for duplicate requests
    usedCodes.set(code, { token, timestamp: Date.now() });

    sendSuccess(res, provider, token);
  } catch (e: any) {
    console.error("OAuth error:", e.message);
    res.statusCode = 200;
    res.end(`
      <script>
        if (window.opener) {
          window.opener.postMessage(
            'authorization:${provider}:error:${JSON.stringify({ error: e.message })}',
            "*"
          );
        }
      </script>
    `);
  }
};

function sendSuccess(res: ServerResponse, provider: string, token: string) {
  res.statusCode = 200;
  res.end(`
    <script>
      (function() {
        if (!window.opener) return;
        window.opener.postMessage("authorizing:${provider}", "*");
        setTimeout(function() {
          window.opener.postMessage(
            'authorization:${provider}:success:${JSON.stringify({ token, provider })}',
            "*"
          );
          window.close();
        }, 100);
      })();
    </script>
  `);
}

function exchangeToken(postData: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "github.com",
      path: "/login/oauth/access_token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
        "Accept": "application/json",
      },
    }, (response) => {
      let data = "";
      response.on("data", (chunk) => { data += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error("Invalid response from GitHub")); }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}
