import type { Handler, HandlerEvent, HandlerResponse } from "@netlify/functions";

const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing url parameter" }),
    };
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: `Proxy failed with status ${response.status}` }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.warn(`[Proxy] Failed to fetch from ${targetUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to fetch from target URL" }),
    };
  }
};

export { handler };
