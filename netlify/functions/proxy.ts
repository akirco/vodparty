import type {
  Handler,
  HandlerEvent,
  HandlerResponse,
} from '@netlify/functions';
import { validateProxyUrl } from '../../src/shared/validateProxy';

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

  const validation = validateProxyUrl(targetUrl);
  if (!validation.valid) {
    return {
      statusCode: 403,
      body: JSON.stringify({ error: validation.error }),
    };
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'application/json, text/plain, */*',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: `Proxy failed with status ${response.status}`,
        }),
      };
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      !contentType.includes('application/json') &&
      !contentType.includes('text/plain')
    ) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Only JSON responses are allowed' }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.warn(
      `[Proxy] Failed to fetch from ${targetUrl}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch from target URL' }),
    };
  }
};

export { handler };
