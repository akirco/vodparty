import type {
  Handler,
  HandlerEvent,
  HandlerResponse,
} from '@netlify/functions';
import { fetchUpstreamJson } from '../../src/shared/fetchJson';

const handler: Handler = async (
  event: HandlerEvent,
): Promise<HandlerResponse> => {
  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing url parameter' }),
    };
  }

  // Same shared implementation as server.ts (SSRF validation, body-size cap,
  // JSON-by-parse check), so both deployments behave identically.
  const { status, data } = await fetchUpstreamJson(targetUrl);

  return {
    statusCode: status,
    body: JSON.stringify(data),
  };
};

export { handler };
