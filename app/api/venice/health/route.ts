export async function GET() {
  const apiKey = process.env.VENICE_API_KEY;

  if (!apiKey) {
    return Response.json({
      status: 'unconfigured',
      message: 'VENICE_API_KEY not set in environment',
    });
  }

  try {
    const res = await fetch('https://api.venice.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      return Response.json({
        status: 'error',
        code: res.status,
        message: `Venice API returned ${res.status}: ${res.statusText}`,
      });
    }

    const data = await res.json();
    const modelCount = data?.data?.length ?? 0;

    // Quick chat completion test
    const chatRes = await fetch('https://api.venice.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'venice-uncensored-1-2',
        messages: [{ role: 'user', content: 'Reply with just: ok' }],
        max_tokens: 5,
        venice_parameters: { include_venice_system_prompt: false },
      }),
    });

    const chatOk = chatRes.ok;
    const balance = res.headers.get('x-venice-balance-usd') || 'unknown';

    return Response.json({
      status: chatOk ? 'ok' : 'chat_failed',
      modelsAvailable: modelCount,
      balanceUsd: balance,
      streamingSupported: chatOk,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      status: 'unreachable',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
