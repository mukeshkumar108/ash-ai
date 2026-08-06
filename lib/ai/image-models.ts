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
    id: 'google/nano-banana-2-lite',
    name: 'Nano Banana 2 Lite',
    description: 'Google Nano Banana 2 Lite — up to 10 reference images.',
    provider: 'replicate',
    version: '8bd4298c0f1887a53a351a0b01d46c92ac8aceff14a16c743f958b291d5e5b40',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 10,
      aspectRatios: [
        '1:1',
        '1:4',
        '1:8',
        '2:3',
        '3:2',
        '3:4',
        '4:1',
        '4:3',
        '4:5',
        '5:4',
        '8:1',
        '9:16',
        '16:9',
        '21:9',
      ],
      outputFormats: ['jpg', 'png'],
    },
  },
  {
    id: 'google/nano-banana-2',
    name: 'Nano Banana 2',
    description: 'Google Nano Banana 2 — editing, resolution locked to 1K.',
    provider: 'replicate',
    version: 'd1be8b5fc0931a253d417e12a484ac01ee9ccbc6daffd4792151377d5e5ff55f',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    fixedInput: { resolution: '1K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 10,
      aspectRatios: [
        '1:1',
        '1:4',
        '1:8',
        '2:3',
        '3:2',
        '3:4',
        '4:1',
        '4:3',
        '4:5',
        '5:4',
        '8:1',
        '9:16',
        '16:9',
        '21:9',
      ],
      outputFormats: ['jpg', 'png'],
    },
  },
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    description:
      'OpenAI GPT Image 2 — editing, up to 10 refs, 4 outputs, quality presets.',
    provider: 'replicate',
    version: '225c978a7f938acc350564c4548ddc2476bfb33364bec6b5422227f55ce56bd3',
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
      maxRefImages: 10,
      aspectRatios: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16'],
      outputFormats: ['png', 'jpeg', 'webp'],
      numOutputs: { default: 1, max: 4 },
      quality: { default: 'low', options: ['low', 'medium'] },
    },
  },
  {
    id: 'bytedance/seedream-5-pro',
    name: 'Seedream 5 Pro',
    description:
      'ByteDance Seedream 5 Pro — editing, up to 10 refs, output locked to 1K.',
    provider: 'replicate',
    version: '483a47c41bddf60948994a640032ecace13da4c5e8aab9f9702008532895f951',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    fixedInput: { size: '1K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 10,
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
      outputFormats: ['png', 'jpeg'],
    },
  },
  {
    id: 'bytedance/seedream-5-lite',
    name: 'Seedream 5 Lite',
    description:
      'ByteDance Seedream 5 Lite — editing, up to 10 refs, 4 outputs, locked to 2K.',
    provider: 'replicate',
    version: 'eeb2857d94c49a5bcbc9d6c6057416e1d3b1a2735a16e08e4def9bf7ee22ec71',
    promptField: 'prompt',
    imageField: 'image_input',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    numOutputsField: 'max_images',
    fixedInput: { size: '2K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 10,
      aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
      outputFormats: ['png', 'jpeg'],
      numOutputs: { default: 1, max: 4 },
    },
  },
  {
    id: 'wan-video/wan-2.7-image',
    name: 'Wan 2.7 Image',
    description:
      'Wan 2.7 Image — editing, up to 9 refs, 4 outputs, locked to 2K.',
    provider: 'replicate',
    version: '2e9f097d4acc02be2d0d86ea8034402c9913488309db62dd8b7dbca3f810326c',
    promptField: 'prompt',
    imageField: 'images',
    imageFieldIsArray: true,
    numOutputsField: 'num_outputs',
    fixedInput: { size: '2K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 9,
      aspectRatios: [],
      outputFormats: [],
      numOutputs: { default: 1, max: 4 },
    },
  },
  {
    id: 'wan-video/wan-2.7-image-pro',
    name: 'Wan 2.7 Image Pro',
    description:
      'Wan 2.7 Image Pro — editing, up to 9 refs, 4 outputs, locked to 2K.',
    provider: 'replicate',
    version: 'd880bad3fb109170221d7c233c4665bab6ba83d01936f3c9b1389de6ed2a82ed',
    promptField: 'prompt',
    imageField: 'images',
    imageFieldIsArray: true,
    numOutputsField: 'num_outputs',
    fixedInput: { size: '2K' },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 9,
      aspectRatios: [],
      outputFormats: [],
      numOutputs: { default: 1, max: 4 },
    },
  },
  {
    id: 'black-forest-labs/flux-2-max',
    name: 'Flux 2 Max',
    description:
      'Black Forest Labs Flux 2 Max — editing, up to 8 refs, output locked to 1MP.',
    provider: 'replicate',
    version: '9c23b0aaa98765a9676dbdda58b9c9915627751300747bad54cb1c11b135d3ca',
    promptField: 'prompt',
    imageField: 'input_images',
    imageFieldIsArray: true,
    aspectRatioField: 'aspect_ratio',
    outputFormatField: 'output_format',
    fixedInput: { resolution: '1 MP', safety_tolerance: 5 },
    capabilities: {
      textToImage: true,
      imageToImage: true,
      maxRefImages: 8,
      aspectRatios: [
        '1:1',
        '16:9',
        '3:2',
        '2:3',
        '4:5',
        '5:4',
        '9:16',
        '3:4',
        '4:3',
      ],
      outputFormats: ['webp', 'jpg', 'png'],
    },
  },
];

export function getImageModelById(id: string) {
  return imageModels.find((imageModel) => imageModel.id === id);
}
