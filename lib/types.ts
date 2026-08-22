import { z } from 'zod';
import type { UIMessage } from 'ai';
import type { ArtifactKind } from '@/components/artifact';
import type { Suggestion } from './db/schema';
import type { TranscriptReliability } from './transcript-reliability';

export type DataPart = { type: 'append-message'; message: string };

export const messageMetadataSchema = z.object({
  createdAt: z.string(),
});

export type MessageMetadata = z.infer<typeof messageMetadataSchema>;

export type ChatTools = Record<string, never>;

export type ResearchActivity = {
  kind: 'web' | 'news' | 'video' | 'image' | 'place' | 'page' | 'weather';
  query: string;
  resultCount?: number;
  status?: 'success' | 'failed';
  sourceRole?: 'official' | 'full_text_mirror' | 'secondary' | 'unverified';
  failure?: 'blocked' | 'timeout' | 'unavailable';
};

export type ResearchSource = {
  title: string;
  url: string;
  hostname: string;
  cited?: boolean;
  retrieval?: 'search_context' | 'page_read';
  sourceRole?: ResearchActivity['sourceRole'];
};

export type ResearchTrace = {
  activities: ResearchActivity[];
  sources: ResearchSource[];
};

export type CustomUIDataTypes = {
  textDelta: string;
  imageDelta: string;
  sheetDelta: string;
  codeDelta: string;
  suggestion: Suggestion;
  appendMessage: string;
  id: string;
  title: string;
  kind: ArtifactKind;
  clear: null;
  finish: null;
  research: ResearchTrace;
  transcriptReliability: TranscriptReliability;
};

export type ChatMessage = UIMessage<
  MessageMetadata,
  CustomUIDataTypes,
  ChatTools
>;

export interface Attachment {
  name: string;
  url: string;
  contentType: string;
  id?: string;
}
