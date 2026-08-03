export interface ImageModelCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  /** Max reference images the model accepts for image-to-image (0 = none). */
  maxRefImages: number;
  aspectRatios: string[];
  outputFormats: string[];
  /** Selectable number of images to generate per request. */
  numOutputs?: { default: number; max: number };
  /** Selectable quality presets. */
  quality?: { default: string; options: string[] };
}

export interface ImageModel {
  id: string;
  name: string;
  description: string;
  provider: 'replicate';
  /** Replicate prediction version hash for this model. */
  version: string;
  /** Field name for the text prompt in the model's Replicate input schema. */
  promptField: string;
  /** Field name for the reference image input (image-to-image), if any. */
  imageField?: string;
  /** True when the image field expects an array (e.g. `image_input`). */
  imageFieldIsArray?: boolean;
  aspectRatioField?: string;
  outputFormatField?: string;
  /** Field name for the number-of-images input, if selectable. */
  numOutputsField?: string;
  /** Field name for the quality input, if selectable. */
  qualityField?: string;
  /** Extra input values always sent (hardcoded, not user-facing). */
  fixedInput?: Record<string, unknown>;
  capabilities: ImageModelCapabilities;
}

export const imageModels: ImageModel[] = [
  {
    id: 'google/imagen-4-fast',
    name: 'Imagen 4 Fast',
    description: 'Google Imagen 4 Fast — fast text-to-image.',
    provider: 'replicate',
    version:
      'efb61e33cffb69a1725083f675a44793929553f479918d01d6ce6e00efbee0d7',
    promptField: 'prompt',
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    capabilities: {
      textToImage: true,
      imageToImage: false,
      maxRefImages: 0,
      aspectRatios: ['1:1', '9:16', '16:9', '3:4', '4:3'],
      outputFormats: ['jpg', 'png'],
    },
  },
  {
    id: 'stability-ai/stable-diffusion-3.5-large',
    name: 'Stable Diffusion 3.5 Large',
    description: 'SD3.5 Large — text-to-image and image-to-image.',
    provider: 'replicate',
    version:
      '2fdf9488b53c1e0fd3aef7b477def1c00d1856a38466733711f9c769942598f5',
    promptField: 'prompt',
    imageField: 'image',
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: ['1:1', '9:16', '16:9', '3:2', '2:3', '4:5', '5:4', '21:9'],
      outputFormats: ['webp', 'jpg', 'png'],
    },
  },
  {
    id: 'google/nano-banana-2',
    name: 'Nano Banana 2',
    description: 'Google Nano Banana 2 — resolution locked to 1K.',
    provider: 'replicate',
    version:
      'd1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    fixedInput: { resolution: '1K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: [
        '1:1', '1:4', '1:8', '2:3', '3:2', '3:4', '4:1', '4:3', '4:5',
        '5:4', '8:1', '9:16', '16:9', '21:9',
      ],
      outputFormats: ['jpg', 'png'],
    },
  },
  {
    id: 'openai/gpt-image-1.5',
    name: 'GPT Image 1.5',
    description: 'OpenAI GPT Image 1.5 — up to 4 images, quality presets.',
    provider: 'replicate',
    version:
      '118f53498ea7319519229b2d5bd0d4a69e3d77eb60d6292d5db38125534dc1ca',
    promptField: 'prompt',
    imageField: 'input_images',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    numOutputsField: 'number_of_images',
    qualityField: 'quality',
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: ['1:1', '3:2', '2:3'],
      outputFormats: ['png', 'jpeg', 'webp'],
      numOutputs: { default: 1, max: 4 },
      quality: { default: 'low', options: ['low', 'medium'] },
    },
  },
  {
    id: 'black-forest-labs/flux-2-pro',
    name: 'Flux 2 Pro',
    description: 'Black Forest Labs Flux 2 Pro — safety tolerance locked at 5.',
    provider: 'replicate',
    version:
      'ccb5e33141097816e6fab8c895e702fe4c619e4e07500885b71214e9f6382a5c',
    promptField: 'prompt',
    imageField: 'input_images',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    fixedInput: { safety_tolerance: 5 },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: ['1:1', '16:9', '3:2', '2:3', '4:5', '5:4', '9:16', '3:4', '4:3'],
      outputFormats: ['webp', 'jpg', 'png'],
    },
  },
  {
    id: 'bytedance/seedream-5-lite',
    name: 'Seedream 5 Lite',
    description: 'ByteDance Seedream 5 Lite — up to 4 images.',
    provider: 'replicate',
    version:
      'eeb2857d94c49a5bcbc9d6c6057416e1d3b1a2735a16e08e4def9bf7ee22ec71',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    numOutputsField: 'max_images',
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
      outputFormats: ['png', 'jpeg'],
      numOutputs: { default: 1, max: 4 },
    },
  },
  {
    id: 'xai/grok-imagine-image',
    name: 'Grok Imagine',
    description: 'xAI Grok Imagine — text-to-image and image-to-image.',
    provider: 'replicate',
    version:
      '3032db31147241f86351f0d7ab1ffd5150dcb482bcb873580f15d8cb8970a812',
    promptField: 'prompt',
    imageField: 'image',
    aspectRatioField: 'aspect_ratio',
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      outputFormats: [],
    },
  },
  {
    id: 'ideogram-ai/ideogram-v3-turbo',
    name: 'Ideogram V3 Turbo',
    description: 'Ideogram V3 Turbo — magic prompt enabled.',
    provider: 'replicate',
    version:
      'd9b3748f95c0fe3e71f010f8cc5d80e8f5252acd0e74b1c294ee889eea52a47b',
    promptField: 'prompt',
    imageField: 'image',
    aspectRatioField: 'aspect_ratio',
    fixedInput: { magic_prompt_option: 'On' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 1,
      aspectRatios: [
        '1:1', '16:9', '9:16', '10:16', '16:10', '2:3', '3:2', '3:4', '4:3',
        '4:5', '5:4', '1:2', '2:1', '1:3', '3:1',
      ],
      outputFormats: [],
    },
  },
  {
    id: 'black-forest-labs/flux-schnell',
    name: 'Flux Schnell',
    description: 'Flux Schnell — safety checker disabled, up to 4 images.',
    provider: 'replicate',
    version:
      'c846a69991daf4c0e5d016514849d14ee5b2e6846ce6b9d6f21369e564cfe51e',
    promptField: 'prompt',
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    numOutputsField: 'num_outputs',
    fixedInput: { disable_safety_checker: true },
    capabilities: {
      textToImage: true,
      imageToImage: false,
      maxRefImages: 0,
      aspectRatios: ['1:1', '16:9', '21:9', '3:2', '2:3', '4:5', '5:4', '3:4', '4:3', '9:16', '9:21'],
      outputFormats: ['webp', 'jpg', 'png'],
      numOutputs: { default: 1, max: 4 },
    },
  },
];

export function getImageModelById(id: string) {
  return imageModels.find((imageModel) => imageModel.id === id);
}
