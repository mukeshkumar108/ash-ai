import { VoiceCall } from '@/components/voice-call';
import { generateUUID } from '@/lib/utils';

// A call joins an existing chat (?chat=<id>) or starts a new one, so the
// spoken turns are ordinary chat history shared with text.
export default async function VoicePage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>;
}) {
  const { chat } = await searchParams;
  const chatId =
    chat && /^[0-9a-f-]{36}$/iu.test(chat) ? chat : generateUUID();
  return <VoiceCall chatId={chatId} />;
}
