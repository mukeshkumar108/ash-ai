import { NextResponse } from 'next/server';

import { auth } from '@/app/(auth)/auth';
import { getImageModelById } from '@/lib/ai/image-models';

export const maxDuration = 60;

const ENHANCE_MODEL = 'openai/gpt-4o-mini';
const MAX_PROMPT_LENGTH = 5000;

function capabilitySummary(modelId: string) {
  const model = getImageModelById(modelId);
  if (!model) return '';
  const { capabilities } = model;
  return [
    `Model: ${model.name} (${model.id})`,
    capabilities.textToImage ? '- text-to-image' : '',
    capabilities.imageToImage ? '- image-to-image' : '',
    capabilities.maxRefImages > 0
      ? `- accepts a reference image`
      : '- text-only (no reference image)',
    capabilities.aspectRatios.length > 0
      ? `- aspect ratios: ${capabilities.aspectRatios.join(', ')}`
      : '',
    capabilities.numOutputs
      ? `- can output ${capabilities.numOutputs.max} images`
      : '',
    capabilities.quality
      ? `- quality presets: ${capabilities.quality.options.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM_PROMPT = (modelId: string) => `
You are an expert AI image-generation prompt rewriter. A user gives you a rough idea; you rewrite it into a strong, detailed prompt for a specific image model.

The target model:
${capabilitySummary(modelId)}

Rules:
- Preserve the user's core intent exactly. Do not change the subject, mood, or meaning — only strengthen the phrasing.
- Add useful detail where it genuinely helps (subject, composition, lighting, mood, style, camera/medium) without padding.
- Tailor the phrasing to this model's strengths and quirks (some models want short punchy prompts, others reward rich description).
- Do not mention the model, the tool, or that you are rewriting a prompt.
- Output ONLY the rewritten prompt. No commentary, no quotes, no prefixes, no markdown.
`;

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { prompt, modelId } = body as { prompt?: string; modelId?: string };

  if (typeof prompt !== 'string' || prompt.trim().length === 0 || prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      { error: 'A prompt between 1 and 5000 characters is required' },
      { status: 400 },
    );
  }

  const model = getImageModelById(modelId ?? '');

  if (!model) {
    return NextResponse.json({ error: 'Unknown model' }, { status: 400 });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: ENHANCE_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT(model.id) },
          { role: 'user', content: prompt.trim() },
        ],
        max_tokens: 512,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Enhancer request failed (${response.status})` },
        { status: 502 },
      );
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json({ error: 'Enhancer returned no result' }, { status: 502 });
    }

    return NextResponse.json({
      enhancedPrompt: content.trim().slice(0, MAX_PROMPT_LENGTH),
    });
  } catch (error) {
    console.error('[image-enhance] failed', error);
    return NextResponse.json({ error: 'Failed to enhance prompt' }, { status: 500 });
  }
}
