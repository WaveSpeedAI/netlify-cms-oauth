import { IncomingMessage, ServerResponse } from "http";
import { randomBytes } from "crypto";

export default async (req: IncomingMessage, res: ServerResponse) => {
  const { host } = req.headers;
  const client_id = process.env.OAUTH_GITHUB_CLIENT_ID;

  if (!client_id) {
    res.statusCode = 500;
    res.end("Missing OAUTH_GITHUB_CLIENT_ID");
    return;
  }

  const authUrl = new URL("https://github.com/login/oauth/authorize");
  authUrl.searchParams.set("client_id", client_id);
  authUrl.searchParams.set("redirect_uri", `https://${host}/callback`);
  authUrl.searchParams.set("scope", "repo,user");
  authUrl.searchParams.set("state", randomBytes(8).toString("hex"));

  res.writeHead(301, { Location: authUrl.toString() });
  res.end();
};
