import 'server-only';

import type { ImageModel } from './image-models';
import type { RemixInputImage, RemixState } from '@/lib/db/schema';

export type RemixRef = RemixInputImage & { description?: string };

export type LineageHop = {
  generationIndex: number;
  modelId: string;
  prompt: string;
  instruction: string | null;
  remixState: RemixState | null;
};

export type RemixContext = {
  /** The output being edited. Always the first image sent to the model. */
  baseline: RemixRef;
  /** Supplementary, role-labelled references (baseline excluded). */
  refs: RemixRef[];
  /** The user's raw instruction, sent verbatim when unambiguous. */
  instruction: string;
  /** Compact creative state inherited from the parent output. */
  parentState: RemixState | null;
  /**
   * Targeted ancestor history. Only populated when the instruction references
   * an earlier generation ("bring back the table from version one"). The hot
   * path for remixes is `parentState` + `instruction` + `refs`, not this.
   */
  lineage: LineageHop[];
  /** The user-selected editing model. The compiler adapts, never replaces it. */
  model: ImageModel;
};

export type RemixPlan = {
  /** Resolved prompt for the image model. */
  prompt: string;
  /** Semantic inputs, baseline first. The provider adapter maps these. */
  inputs: RemixRef[];
  /** Compact creative state for the child output. */
  nextState: RemixState;
  warnings: string[];
  /** True when the LLM compiler ran; false for the deterministic path. */
  compiled: boolean;
};

export type ResolvedRemixInput = RemixRef & { dataUri: string };

const COMPILER_MODEL = 'openai/gpt-4o-mini';
const MAX_PROMPT_LENGTH = 5000;

const DIRECT_EDIT_WRAPPER = `Edit the supplied baseline image. Change only what the user requests. Preserve unrelated composition, identity, geometry and visible details.

User instruction:
`;

function capabilitySummary(model: ImageModel) {
  const { capabilities } = model;
  return [
    `Model: ${model.name} (${model.id})`,
    capabilities.imageToImage
      ? '- image-to-image'
      : '- text-only (no reference image)',
    capabilities.maxRefImages > 0
      ? `- accepts up to ${capabilities.maxRefImages} reference images`
      : '',
    capabilities.aspectRatios.length > 0
      ? `- aspect ratios: ${capabilities.aspectRatios.join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function emptyRemixState(originalIntent: string): RemixState {
  return {
    originalIntent,
    locked: [],
    preserve: [],
    established: [],
    removed: [],
  };
}

function roleDescription(role: RemixInputImage['role']): string {
  switch (role) {
    case 'baseline':
      return 'the image being edited';
    case 'style':
      return 'style/mood/colour reference';
    case 'object':
      return 'object/element reference';
    case 'identity':
      return 'person/character identity reference';
    case 'layout':
      return 'layout/composition reference';
  }
}

function serializeState(state: RemixState | null): string {
  if (!state) return 'No inherited creative state.';
  const lines = [
    `Original intent: ${state.originalIntent || '(not recorded)'}`,
  ];
  if (state.locked.length > 0) {
    lines.push(`Locked (must preserve exactly): ${state.locked.join('; ')}`);
  }
  if (state.preserve.length > 0) {
    lines.push(
      `Preserve (keep stable unless the change requires otherwise): ${state.preserve.join('; ')}`,
    );
  }
  if (state.established.length > 0) {
    lines.push(`Established in the image: ${state.established.join('; ')}`);
  }
  if (state.removed.length > 0) {
    lines.push(
      `Removed earlier (do not resurrect): ${state.removed.join('; ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * True when the instruction points at an earlier generation ("bring back the
 * table from version one"). Used to decide whether to load targeted lineage.
 */
export function referencesAncestor(instruction: string): boolean {
  const text = instruction.toLowerCase();
  return (
    /(version|gen|earlier|previous|before|original|first|last)\s*[0-9]*/.test(
      text,
    ) ||
    /(bring back|restore|revert|go back|undo|like (the|it) (was|before)|original (one|look|design|table)|same (as|style) (before|earlier))/.test(
      text,
    )
  );
}

/**
 * Deterministic trigger for the LLM compiler. Direct, unambiguous edits use the
 * deterministic wrapper; contextual/complex cases compile.
 */
export function requiresCompilation(ctx: RemixContext): boolean {
  const ancestorRef = referencesAncestor(ctx.instruction);
  const hasRoleRefs = ctx.refs.length > 0;
  const hasLocked = (ctx.parentState?.locked.length ?? 0) > 0;
  const vague = ctx.instruction.split(/\s+/).filter(Boolean).length <= 2;
  const multiPart =
    ctx.instruction.split(/[;,.\n]/).filter(Boolean).length >= 3;
  return ancestorRef || hasRoleRefs || hasLocked || vague || multiPart;
}

export function buildDirectPrompt(instruction: string): string {
  return `${DIRECT_EDIT_WRAPPER}${instruction.trim()}`;
}

function parseCompilerJson(content: string): {
  prompt: string;
  nextState: RemixState;
  warnings: string[];
} | null {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(cleaned) as {
      prompt?: string;
      nextState?: Partial<RemixState>;
      warnings?: string[];
    };
    if (
      typeof parsed.prompt !== 'string' ||
      parsed.prompt.trim().length === 0
    ) {
      return null;
    }
    const fallback = emptyRemixState('');
    return {
      prompt: parsed.prompt.trim(),
      nextState: {
        originalIntent:
          parsed.nextState?.originalIntent ?? fallback.originalIntent,
        locked: Array.isArray(parsed.nextState?.locked)
          ? parsed.nextState.locked
          : [],
        preserve: Array.isArray(parsed.nextState?.preserve)
          ? parsed.nextState.preserve
          : [],
        established: Array.isArray(parsed.nextState?.established)
          ? parsed.nextState.established
          : [],
        removed: Array.isArray(parsed.nextState?.removed)
          ? parsed.nextState.removed
          : [],
      },
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
    };
  } catch {
    return null;
  }
}

const COMPILER_SYSTEM_PROMPT = `
You are a remix compiler for an AI image editing studio. Given a user's instruction, the baseline image being edited, role-labelled reference images, and compact creative state inherited from previous edits, produce the smallest valid image-editing prompt that makes exactly the requested change while disturbing as little else as possible.

Rules:
- The prompt you emit is sent to a diffusion image model that SEES the baseline and all reference images.
- Do not gratuitously rewrite concrete instructions ("make the sofa blue" stays "make the sofa blue"). Expand only what is needed to resolve references ("like the earlier version" -> what that version contained), restore removed elements, or reconcile conflicting constraints.
- The baseline image is the single source of truth. History helps interpret intent; it must never override what is visibly present. Never emit a prompt that regenerates from scratch.
- Honour locked constraints exactly. Treat preserve as soft continuity (keep stable unless the change requires otherwise).
- Do not resurrect elements listed as removed.
- Only use lineage context when the instruction references an earlier generation.
- Populate nextState meaningfully — do not return empty lists:
  - preserve: elements the user explicitly asks to keep, or that must stay stable for the requested change to work.
  - established: concrete, visible elements in the current baseline image (from the baseline description or inherited state) that are stable facts a future edit may reference.
  - removed: carry forward prior removed items, plus anything the current instruction removes.
  - locked: carry forward prior locked constraints; add a new one only when the user uses strong preservation language ("keep the room layout exactly the same").
- Keep every list concise (under 8 items). Return JSON only, no markdown:
{"prompt":"...","nextState":{"originalIntent":"...","locked":[...],"preserve":[...],"established":[...],"removed":[...]},"warnings":[]}
`;

async function compileWithLLM(ctx: RemixContext): Promise<RemixPlan> {
  const refLines = [ctx.baseline, ...ctx.refs]
    .map(
      (ref, i) =>
        `${i === 0 ? 'BASELINE' : `REF ${i} (${ref.role} — ${roleDescription(ref.role)})`}:${ref.description ? ` ${ref.description}` : ''}`,
    )
    .join('\n');

  const lineageLines = ctx.lineage.length
    ? ctx.lineage
        .map(
          (hop) =>
            `- gen ${hop.generationIndex} [${hop.modelId}]: ${
              hop.instruction ? `instruction: "${hop.instruction}" | ` : ''
            }resolved prompt: "${hop.prompt}"`,
        )
        .join('\n')
    : '';

  const userMessage = [
    'The target model:',
    capabilitySummary(ctx.model),
    '',
    'Creative state inherited from parent:',
    serializeState(ctx.parentState),
    '',
    'Baseline and references:',
    refLines,
    ...(lineageLines
      ? ['', 'Targeted earlier lineage (only use if referenced):', lineageLines]
      : []),
    '',
    `User instruction:\n${ctx.instruction.trim()}`,
  ].join('\n');

  const response = await fetch(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: COMPILER_MODEL,
        messages: [
          { role: 'system', content: COMPILER_SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 1024,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Remix compiler request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Remix compiler returned no result');
  }

  const compiled = parseCompilerJson(content);
  if (!compiled) {
    throw new Error('Remix compiler returned malformed JSON');
  }

  return {
    prompt: compiled.prompt.slice(0, MAX_PROMPT_LENGTH),
    inputs: [ctx.baseline, ...ctx.refs],
    nextState: compiled.nextState,
    warnings: compiled.warnings,
    compiled: true,
  };
}

/**
 * Build the remix plan for a context. Direct edits take a deterministic path;
 * contextual/complex edits go through the LLM compiler.
 */
export async function compileRemix(ctx: RemixContext): Promise<RemixPlan> {
  if (requiresCompilation(ctx)) {
    try {
      return await compileWithLLM(ctx);
    } catch (error) {
      // Fall back to the deterministic path on compiler failure rather than
      // failing the whole remix.
      console.error(
        '[remix-compiler] failed, falling back to direct path',
        error,
      );
    }
  }

  const prompt = buildDirectPrompt(ctx.instruction);
  const parent = ctx.parentState ?? emptyRemixState(prompt);
  return {
    prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
    inputs: [ctx.baseline, ...ctx.refs],
    nextState: {
      originalIntent: parent.originalIntent,
      locked: [...parent.locked],
      preserve: [...parent.preserve],
      established: [...parent.established],
      removed: [...parent.removed],
    },
    warnings: [],
    compiled: false,
  };
}

/**
 * Provider-input adapter: maps the semantic plan (baseline first, role-labelled)
 * to the selected model's Replicate input shape. Roles already influenced the
 * prompt text; here they only affect ordering and which refs are sent. The
 * baseline always occupies the first slot. Inputs arrive as base64 data URIs —
 * Replicate cannot fetch our private blob URLs, so the server resolves each
 * pathname to a data URI before this adapter runs.
 */
export function buildProviderInput(
  model: ImageModel,
  prompt: string,
  inputs: ResolvedRemixInput[],
): Record<string, unknown> {
  const input: Record<string, unknown> = { [model.promptField]: prompt };

  if (model.imageField && inputs.length > 0) {
    const cap = model.capabilities.maxRefImages;
    const usable = cap > 0 ? inputs.slice(0, cap) : inputs.slice(0, 1);
    const dataUris = usable.map((ref) => ref.dataUri);
    input[model.imageField] = model.imageFieldIsArray ? dataUris : dataUris[0];
  }

  return input;
}
