import type { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";
import Pusher from "pusher";

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || "",
  key: process.env.PUSHER_KEY || "",
  secret: process.env.PUSHER_SECRET || "",
  cluster: process.env.PUSHER_CLUSTER || "ap1",
  useTLS: true,
});

const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const contentType = event.headers["content-type"] || "";
    let socketId: string;
    let channelName: string;

    if (contentType.includes("application/json")) {
      const body = event.body ? JSON.parse(event.body) : {};
      socketId = body.socket_id;
      channelName = body.channel_name;
    } else {
      // URL-encoded form data
      const params = new URLSearchParams(event.body || "");
      socketId = params.get("socket_id") || "";
      channelName = params.get("channel_name") || "";
    }

    if (!socketId || !channelName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing socket_id or channel_name" }),
      };
    }

    if (!channelName.startsWith("private-party-")) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Unauthorized channel" }),
      };
    }

    const auth = pusher.authorizeChannel(socketId, channelName);

    return {
      statusCode: 200,
      body: JSON.stringify(auth),
    };
  } catch (error) {
    console.error("Pusher auth error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Authorization failed" }),
    };
  }
};

export { handler };