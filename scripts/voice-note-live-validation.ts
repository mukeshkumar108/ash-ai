import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { synthesizeWithElevenLabs, transcribeWithLemonFox } from '@/lib/voice';

async function main() {
  const files = process.argv.slice(2);
  const lemonFoxKey = process.env.LEMONFOX_API_KEY?.trim();
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY?.trim();
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID?.trim() || 'YY7fzZmDizFQQv8XPAIY';

  if (!lemonFoxKey || !elevenLabsKey || files.length < 3) {
    throw new Error(
      'Usage: provide three audio files and configure both provider keys.',
    );
  }

  for (const filename of files.slice(0, 3)) {
    const bytes = await readFile(filename);
    const started = performance.now();
    const transcript = await transcribeWithLemonFox({
      file: new Blob([bytes], { type: 'audio/webm' }),
      apiKey: lemonFoxKey,
    });
    console.log(
      JSON.stringify({
        provider: 'lemonfox',
        file: basename(filename),
        transcript,
        latencyMs: Math.round(performance.now() - started),
      }),
    );
  }

  const reply =
    "That sounds like a good walk. Keep going; I'm right here with you.";
  const started = performance.now();
  const { audio, spokenText } = await synthesizeWithElevenLabs({
    text: reply,
    apiKey: elevenLabsKey,
    voiceId,
  });
  const output = '/tmp/sophie-voice-reply.mp3';
  await writeFile(output, new Uint8Array(audio));
  console.log(
    JSON.stringify({
      provider: 'elevenlabs',
      spokenText,
      voiceId,
      bytes: audio.byteLength,
      latencyMs: Math.round(performance.now() - started),
      output,
    }),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Voice validation failed.',
  );
  process.exitCode = 1;
});
