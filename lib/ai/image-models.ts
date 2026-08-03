export interface ImageModelCapabilities {
  textToImage: boolean;
  imageToImage: boolean;
  /** Max reference images the model accepts for image-to-image (0 = none). */
  maxRefImages: number;
  aspectRatios: string[];
  outputFormats: string[];
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
  aspectRatioField?: string;
  outputFormatField?: string;
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
];

export function getImageModelById(id: string) {
  return imageModels.find((imageModel) => imageModel.id === id);
}
