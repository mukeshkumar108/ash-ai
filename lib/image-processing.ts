import imageCompression from 'browser-image-compression';

export const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const FILE_ACCEPT_ATTR =
  'image/jpeg,image/png,image/webp,image/heic,image/heif';

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_LONG_EDGE = 2560;
export const COMPRESSION_QUALITY = 0.84;
export const TARGET_MAX_BYTES = 4 * 1024 * 1024;

export type ProcessingErrorCode =
  | 'too_large'
  | 'unsupported_type'
  | 'undecodable';

export class ImageProcessingError extends Error {
  code: ProcessingErrorCode;

  constructor(code: ProcessingErrorCode, message: string) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

export interface ProcessedImage {
  file: File;
  sourceType: string;
  outputType: string;
}

function isHeic(type: string) {
  return type === 'image/heic' || type === 'image/heif';
}

function isAcceptedType(type: string) {
  return ACCEPTED_IMAGE_TYPES.includes(type as (typeof ACCEPTED_IMAGE_TYPES)[number]);
}

function replaceExtension(filename: string, extension: string) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return `${base}.${extension}`;
}

function extensionForType(type: string) {
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  return 'webp';
}

function supportsWebpEncoding() {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

async function hasTransparency(file: File) {
  let source: ImageBitmap | null = null;
  try {
    source = await createImageBitmap(file, {
      resizeWidth: 256,
      resizeHeight: 256,
      resizeQuality: 'low',
    });
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    // If we cannot reliably detect transparency, keep PNG (lossless) to avoid
    // destroying alpha channels by converting a transparent image to WebP.
    return true;
  } finally {
    source?.close?.();
  }
}

export function validateImageFile(file: File) {
  if (file.size > MAX_INPUT_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    throw new ImageProcessingError(
      'too_large',
      `Image is ${mb}MB — the maximum is 20MB.`,
    );
  }

  if (!isAcceptedType(file.type)) {
    throw new ImageProcessingError(
      'unsupported_type',
      'Only JPEG, PNG, WebP and HEIC/HEIF images are supported.',
    );
  }
}

export async function processImageFile(
  file: File,
  signal?: AbortSignal,
): Promise<ProcessedImage> {
  validateImageFile(file);

  const webpSupported = supportsWebpEncoding();

  let workFile = file;
  let sourceType = file.type;

  if (isHeic(file.type)) {
    const { default: heic2any } = await import('heic2any');
    const converted = (await heic2any({
      blob: file,
      toType: 'image/webp',
      quality: 0.92,
    })) as Blob;
    workFile = new File([converted], replaceExtension(file.name, 'webp'), {
      type: 'image/webp',
      lastModified: file.lastModified,
    });
    sourceType = 'image/webp';
  }

  let outputType: string;
  if (sourceType === 'image/png') {
    const transparent = await hasTransparency(file);
    outputType = transparent
      ? 'image/png'
      : webpSupported
        ? 'image/webp'
        : 'image/jpeg';
  } else if (sourceType === 'image/jpeg') {
    outputType = webpSupported ? 'image/webp' : 'image/jpeg';
  } else {
    outputType = 'image/webp';
  }

  const compressed = await imageCompression(workFile, {
    maxSizeMB: TARGET_MAX_BYTES / (1024 * 1024),
    maxWidthOrHeight: MAX_LONG_EDGE,
    initialQuality: COMPRESSION_QUALITY,
    fileType: outputType,
    useWebWorker: false,
    preserveExif: false,
    signal,
  });

  const finalFile = new File(
    [compressed],
    replaceExtension(file.name, extensionForType(compressed.type)),
    {
      type: compressed.type,
      lastModified: file.lastModified,
    },
  );

  return {
    file: finalFile,
    sourceType: sourceType,
    outputType: finalFile.type,
  };
}
