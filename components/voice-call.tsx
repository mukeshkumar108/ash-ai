'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  fatalVoiceRuntimeError,
  type VoiceRuntimeServerEvent,
} from '@/lib/voice-runtime-events';

// Thin integration test for Voice Runtime (realtime speech I/O for the
// companion-runtime brain). Browser opens the voice WebSocket directly;
// no brain secret or audio ever passes through Next.js.
// Protocol: session.update -> 16kHz PCM16 mic chunks via
// input_audio_buffer.append; 16kHz PCM16 base64 playback deltas back.
// Server VAD drives turn-taking; no client response.create needed.
type CallState =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'interrupted'
  | 'ended'
  | 'error';

type MicDiagnostics = {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
};

const OUTPUT_SAMPLE_RATE = 16000;
const MIC_CHUNK_MS = 40;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64ToFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.byteLength / 2);
  for (let i = 0; i < samples.length; i++) {
    const s = view.getInt16(i * 2, true);
    samples[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return samples;
}

export function VoiceCall({ chatId }: { chatId: string }) {
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micDiagnostics, setMicDiagnostics] = useState<MicDiagnostics | null>(
    null,
  );
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const captureNodeRef = useRef<AudioWorkletNode | null>(null);
  const playbackNodeRef = useRef<AudioWorkletNode | null>(null);
  const configuredRef = useRef(false);
  const endedRef = useRef(false);
  const failedRef = useRef(false);
  const assistantPlayingRef = useRef(false);
  const traceStartRef = useRef(performance.now());
  const firstAudioByteRef = useRef(false);
  const playbackStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const trace = useCallback(
    (event: string, detail: Record<string, unknown> = {}) => {
      console.info(
        '[voice-trace]',
        JSON.stringify({
          event,
          elapsed_ms: Math.round(performance.now() - traceStartRef.current),
          assistant_playing: assistantPlayingRef.current,
          ...detail,
        }),
      );
    },
    [],
  );

  const teardown = useCallback(() => {
    endedRef.current = true;
    try {
      wsRef.current?.close(1000, 'client hangup');
    } catch {
      // already gone
    }
    wsRef.current = null;
    try {
      captureNodeRef.current?.disconnect();
    } catch {
      // already gone
    }
    try {
      playbackNodeRef.current?.disconnect();
    } catch {
      // already gone
    }
    captureNodeRef.current = null;
    playbackNodeRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => undefined);
    }
    configuredRef.current = false;
    assistantPlayingRef.current = false;
    firstAudioByteRef.current = false;
    if (playbackStopTimerRef.current)
      clearTimeout(playbackStopTimerRef.current);
    playbackStopTimerRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const fail = useCallback(
    (message: string) => {
      failedRef.current = true;
      teardown();
      setError(message);
      setState('error');
    },
    [teardown],
  );

  const pushAudioDelta = useCallback((b64: string) => {
    const node = playbackNodeRef.current;
    if (!node || !b64) return;
    const samples = base64ToFloat32(b64);
    node.port.postMessage({ kind: 'audio', samples }, [samples.buffer]);
  }, []);

  const handleServerEvent = useCallback(
    (raw: unknown) => {
      if (typeof raw !== 'string') return;
      let event: VoiceRuntimeServerEvent;
      try {
        event = JSON.parse(raw) as VoiceRuntimeServerEvent;
      } catch {
        return;
      }
      const fatalError = fatalVoiceRuntimeError(event);
      if (fatalError) {
        fail(fatalError);
        return;
      }
      switch (event.type) {
        case 'session.created':
          // Voice carries no instructions: the Runtime owns the character.
          wsRef.current?.send(
            JSON.stringify({
              type: 'session.update',
              session: { type: 'realtime' },
            }),
          );
          configuredRef.current = true;
          setState('listening');
          break;
        case 'response.output_audio.delta':
          if (!firstAudioByteRef.current) {
            firstAudioByteRef.current = true;
            trace('first_audio_byte');
          }
          pushAudioDelta(event.delta ?? '');
          break;
        case 'response.created':
          firstAudioByteRef.current = false;
          break;
        case 'input_audio_buffer.speech_started':
          trace('vad_speech_started');
          if (!assistantPlayingRef.current) setState('listening');
          break;
        case 'input_audio_buffer.speech_stopped':
          trace('speech_end');
          if (!assistantPlayingRef.current) setState('thinking');
          break;
        case 'conversation.item.input_audio_transcription.delta':
          trace('stt_interim', { transcript: event.delta });
          break;
        case 'conversation.item.input_audio_transcription.completed':
          trace('stt_final', { transcript: event.transcript });
          if (!assistantPlayingRef.current) setState('thinking');
          break;
        case 'voice_runtime.interruption':
          trace(`interruption_${event.phase ?? 'event'}`, {
            transcript: event.transcript,
            classification: event.classification,
            classification_latency_ms: event.classification_latency_ms,
            decision: event.decision,
            reason: event.reason,
          });
          if (event.phase === 'cancelled') {
            playbackNodeRef.current?.port.postMessage({ kind: 'clear' });
            assistantPlayingRef.current = false;
            setState('interrupted');
          }
          break;
        case 'response.done':
          if (event.response?.status === 'cancelled') {
            playbackNodeRef.current?.port.postMessage({ kind: 'clear' });
            assistantPlayingRef.current = false;
            setState('interrupted');
          }
          firstAudioByteRef.current = false;
          break;
        case 'error':
          // Recoverable turn errors leave the socket up. Fatal setup/STT
          // failures are handled above and terminate the misleading Live state.
          break;
        default:
          break;
      }
    },
    [fail, pushAudioDelta, trace],
  );

  const startCall = useCallback(async () => {
    endedRef.current = false;
    failedRef.current = false;
    setError(null);
    setState('connecting');
    traceStartRef.current = performance.now();

    try {
      // The BFF binds this call to the user's chat with a short-lived signed
      // token; the browser holds no Runtime secret and no identity of its own.
      const sessionResponse = await fetch('/api/voice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      });
      if (!sessionResponse.ok) {
        throw new Error('Could not start a voice session');
      }
      const voiceSession = (await sessionResponse.json()) as {
        url: string;
        token: string;
      };
      const url = `${voiceSession.url}${voiceSession.url.includes('?') ? '&' : '?'}token=${encodeURIComponent(voiceSession.token)}`;

      // Created inside the tap gesture so mobile browsers allow audio.
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      ctxRef.current = ctx;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      micStreamRef.current = stream;
      const track = stream.getAudioTracks()[0];
      const applied = track?.getSettings() ?? {};
      const capabilities = track?.getCapabilities?.() ?? {};
      const diagnostics = {
        echoCancellation: applied.echoCancellation,
        noiseSuppression: applied.noiseSuppression,
        autoGainControl: applied.autoGainControl,
      };
      setMicDiagnostics(diagnostics);
      trace('microphone_configured', {
        ...diagnostics,
        echoCancellationCapability: capabilities.echoCancellation,
        noiseSuppressionCapability: capabilities.noiseSuppression,
        autoGainControlCapability: capabilities.autoGainControl,
      });

      await ctx.audioWorklet.addModule('/voice-worklets/mic-capture.js');
      await ctx.audioWorklet.addModule('/voice-worklets/audio-playback.js');

      const capture = new AudioWorkletNode(ctx, 'mic-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { chunkMs: MIC_CHUNK_MS },
      });
      capture.port.onmessage = (e: MessageEvent) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN || !configuredRef.current)
          return;
        ws.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: arrayBufferToBase64(e.data),
          }),
        );
      };
      ctx.createMediaStreamSource(stream).connect(capture);
      captureNodeRef.current = capture;

      const playback = new AudioWorkletNode(ctx, 'audio-playback', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      playback.port.postMessage({
        kind: 'config',
        inputRate: OUTPUT_SAMPLE_RATE,
      });
      playback.port.onmessage = (e: MessageEvent) => {
        if (e.data?.kind === 'playback_started') {
          if (playbackStopTimerRef.current)
            clearTimeout(playbackStopTimerRef.current);
          playbackStopTimerRef.current = null;
          assistantPlayingRef.current = true;
          setState('speaking');
          trace('playback_started');
        } else if (e.data?.kind === 'playback_stopped') {
          if (playbackStopTimerRef.current)
            clearTimeout(playbackStopTimerRef.current);
          playbackStopTimerRef.current = setTimeout(() => {
            assistantPlayingRef.current = false;
            setState('listening');
            trace('playback_stopped');
          }, 300);
        }
      };
      playback.connect(ctx.destination);
      playbackNodeRef.current = playback;

      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.addEventListener('message', (e) => handleServerEvent(e.data));
      ws.addEventListener('error', () => {
        if (!endedRef.current) fail('Could not reach the voice server');
      });
      ws.addEventListener('close', (e) => {
        if (failedRef.current) return;
        if (endedRef.current) {
          setState('ended');
          return;
        }
        fail(
          e.code === 1000
            ? 'Server ended the call'
            : `Connection lost (${e.code})`,
        );
      });
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not start call');
    }
  }, [chatId, fail, handleServerEvent, trace]);

  const endCall = useCallback(() => {
    failedRef.current = false;
    teardown();
    setState('ended');
  }, [teardown]);

  const inCall = !['idle', 'ended', 'error'].includes(state);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
      <div
        className={cn(
          'flex size-24 items-center justify-center rounded-full transition-colors',
          ['listening', 'thinking', 'speaking', 'interrupted'].includes(state)
            ? 'bg-green-500 text-white'
            : state === 'connecting'
              ? 'animate-pulse bg-yellow-500 text-white'
              : state === 'error'
                ? 'bg-red-500 text-white'
                : 'bg-muted text-muted-foreground',
        )}
        data-testid="voice-call-status-dot"
      >
        {inCall ? (
          <Phone className="size-10" />
        ) : (
          <PhoneOff className="size-10" />
        )}
      </div>

      <div>
        <p
          className="text-lg font-medium capitalize"
          data-testid="voice-call-status"
        >
          {state === 'idle' && 'Ready to call'}
          {state === 'connecting' && 'Connecting…'}
          {state === 'listening' && 'Listening'}
          {state === 'thinking' && 'Thinking'}
          {state === 'speaking' && 'Speaking'}
          {state === 'interrupted' && 'Interrupted'}
          {state === 'ended' && 'Call ended'}
          {state === 'error' && 'Call failed'}
        </p>
        {state === 'error' && error && (
          <p
            className="mt-2 max-w-sm text-sm text-red-500"
            data-testid="voice-call-error"
          >
            {error}
          </p>
        )}
        {inCall && micDiagnostics && (
          <p
            className="mt-2 text-xs text-muted-foreground"
            data-testid="voice-mic-settings"
          >
            AEC {micDiagnostics.echoCancellation ? 'on' : 'off'} · noise
            suppression {micDiagnostics.noiseSuppression ? 'on' : 'off'} · auto
            gain {micDiagnostics.autoGainControl ? 'on' : 'off'}
          </p>
        )}
      </div>

      {inCall ? (
        <Button
          onClick={endCall}
          size="lg"
          variant="destructive"
          data-testid="voice-end-call"
        >
          <PhoneOff className="mr-2 size-5" />
          End call
        </Button>
      ) : (
        <Button onClick={startCall} size="lg" data-testid="voice-start-call">
          <Phone className="mr-2 size-5" />
          Call
        </Button>
      )}
    </div>
  );
}
