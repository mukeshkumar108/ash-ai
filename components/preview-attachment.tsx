import type { Attachment } from '@/lib/types';
import { getBlobDisplayUrl } from '@/lib/blob';
import { Clapperboard, FileText, RefreshCw, X } from 'lucide-react';
import { LoaderIcon } from './icons';

export type PendingAttachmentState = 'processing' | 'uploading' | 'failed';

export const PreviewAttachment = ({
  attachment,
  isUploading = false,
  pending,
  onRemove,
  onReplace,
}: {
  attachment?: Attachment;
  isUploading?: boolean;
  pending?: {
    name: string;
    state: PendingAttachmentState;
    error?: string;
  };
  onRemove?: () => void;
  onReplace?: () => void;
}) => {
  const name = pending?.name ?? attachment?.name ?? 'file';
  const url = attachment?.url;
  const mediaType = attachment?.contentType ?? '';

  const state = pending?.state ?? (isUploading ? 'uploading' : 'ready');

  const isImage = mediaType.startsWith('image/');
  const FileIcon = mediaType.startsWith('video/') ? Clapperboard : FileText;

  return (
    <div
      data-testid={
        state === 'ready' ? 'input-attachment-preview' : 'input-attachment-pending'
      }
      className="flex flex-col gap-2 relative group"
    >
      <div className="w-20 h-16 aspect-video bg-muted rounded-md relative flex flex-col items-center justify-center overflow-hidden">
        {state === 'ready' && url && isImage ? (
          // NOTE: it is recommended to use next/image for images
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={url}
            src={getBlobDisplayUrl(url)}
            alt={name ?? 'An image attachment'}
            className="rounded-md size-full object-cover"
          />
        ) : state === 'ready' && url ? (
          <div
            className="size-full flex flex-col items-center justify-center gap-1 text-muted-foreground"
            title={mediaType}
          >
            <FileIcon size={20} />
            <span className="text-[10px] truncate px-1 max-w-full">
              {name.split('/').pop()}
            </span>
          </div>
        ) : (
          <div
            className="rounded-md size-full object-cover flex flex-col items-center justify-center gap-1"
            role="status"
          >
            {state === 'failed' ? (
              <span className="text-[10px] text-red-500 font-medium text-center px-1 leading-tight">
                Failed
              </span>
            ) : (
              <>
                <span className="animate-spin text-zinc-500">
                <LoaderIcon size={16} />
              </span>
                <span className="text-[10px] text-zinc-500">
                  {state === 'processing' ? 'Processing…' : 'Uploading…'}
                </span>
              </>
            )}
          </div>
        )}

        {(onRemove || onReplace) && state !== 'failed' && (
          <div className="absolute top-0.5 right-0.5 flex flex-row gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {onReplace && (
              <button
                type="button"
                data-testid="replace-attachment-button"
                aria-label="Replace image"
                onClick={(event) => {
                  event.preventDefault();
                  onReplace();
                }}
                className="rounded-md bg-zinc-900/70 text-white p-1 hover:bg-zinc-900"
              >
                <RefreshCw size={11} />
              </button>
            )}
            <button
              type="button"
              data-testid="remove-attachment-button"
              aria-label="Remove image"
              onClick={(event) => {
                event.preventDefault();
                onRemove?.();
              }}
              className="rounded-md bg-zinc-900/70 text-white p-1 hover:bg-zinc-900"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {onRemove && state === 'failed' && (
          <button
            type="button"
            data-testid="remove-attachment-button"
            aria-label="Remove image"
            onClick={(event) => {
              event.preventDefault();
              onRemove();
            }}
            className="absolute top-0.5 right-0.5 rounded-md bg-zinc-900/70 text-white p-1 hover:bg-zinc-900"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <div className="text-xs text-zinc-500 max-w-16 truncate">{name}</div>
    </div>
  );
};
