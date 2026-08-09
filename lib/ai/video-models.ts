export interface VideoModelCapabilities {
  /** Selectable durations in seconds. */
  durations: { default: number; max: number };
  /** Selectable resolutions (e.g. 720p / 1080p). */
  resolutions: string[];
  /** Whether the model has a fast draft/preview mode. */
  draft: boolean;
  requiresStartImage: boolean;
  supportsEndFrame: boolean;
  supportsAudio: boolean;
}

export interface VideoModel {
  id: string;
  name: string;
  description: string;
  provider: 'replicate';
  version: string;
  /** Field name for the text prompt in the model's Replicate input schema. */
  promptField: string;
  /** Field name for the start image (image-to-video). */
  imageField: string;
  /** Field name for the optional last-frame reference image. */
  endFrameField?: string;
  /** Field name for the optional conditioning audio. */
  audioField?: string;
  durationField: string;
  resolutionField: string;
  draftField?: string;
  /** Extra input values always sent (hardcoded, not user-facing). */
  fixedInput?: Record<string, unknown>;
  capabilities: VideoModelCapabilities;
  /** Credits charged per second of video for a resolution + draft combo. */
  pricePerSecond: (resolution: string, draft: boolean) => number;
}

export const videoModels: VideoModel[] = [
  {
    id: 'prunaai/p-video',
    name: 'P-Video',
    description:
      'Pruna P-Video — fast text/image/audio-to-video with a 4x draft preview mode. Start image required; optional last-frame reference and conditioning audio.',
    provider: 'replicate',
    version:
      '4420187a2059aa9ec6836c7da161eb11dce9afda5310e29e1d9f65efa9fd58ad',
    promptField: 'prompt',
    imageField: 'image',
    endFrameField: 'last_frame_image',
    audioField: 'audio',
    durationField: 'duration',
    resolutionField: 'resolution',
    draftField: 'draft',
    fixedInput: { prompt_upsampling: true, save_audio: true, fps: 24 },
    capabilities: {
      durations: { default: 5, max: 10 },
      resolutions: ['720p', '1080p'],
      draft: true,
      requiresStartImage: true,
      supportsEndFrame: true,
      supportsAudio: true,
    },
    pricePerSecond: (resolution, draft) => {
      if (resolution === '1080p') return draft ? 0.8 : 2;
      return draft ? 0.4 : 1;
    },
  },
  {
    id: 'xai/grok-imagine-video',
    name: 'Grok Imagine Video',
    description:
      'xAI Grok Imagine Video — animates a still image into a short video with synchronized audio. Prompt describes the motion.',
    provider: 'replicate',
    version:
      'ec05ebf490fb5db7e17e73c456e80cb1242d4df8ade9bd7300c66ea2108288bc',
    promptField: 'prompt',
    imageField: 'image',
    durationField: 'duration',
    resolutionField: 'resolution',
    capabilities: {
      durations: { default: 3, max: 5 },
      resolutions: ['480p', '720p'],
      draft: false,
      requiresStartImage: true,
      supportsEndFrame: false,
      supportsAudio: false,
    },
    pricePerSecond: () => 1.5,
  },
];

export function getVideoModelById(id: string) {
  return videoModels.find((videoModel) => videoModel.id === id);
}

/** Total credit cost (rounded up) for a video request. */
export function calculateVideoGemCost(
  model: VideoModel,
  durationSeconds: number,
  resolution: string,
  draft: boolean,
) {
  const rate = model.pricePerSecond(resolution, draft);
  return Math.max(1, Math.ceil(durationSeconds * rate));
}
