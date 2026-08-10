# Audio transcript reliability

Only audio-derived user messages enter this layer. Typed messages contain no `data-transcriptReliability` part and bypass it.

The LemonFox transcription route first checks language-agnostic mechanical evidence: transcript length relative to recording duration, repeated five-word windows, severe phrase loops, low lexical novelty and duplicated clauses. Normal rambling, slang, code-switching, abrupt topic changes and unusual content are not signals by themselves.

Clean transcripts are accepted without another model call. Suspicious transcripts receive one small structured judgment from `google/gemini-3.1-flash-lite` by default, configurable with `TRANSCRIPT_RELIABILITY_MODEL`. The judgment asks whether the transcription process appears to have degenerated, not whether the speaker sounds strange or stays on topic. A failed judgment falls back to the mechanical assessment and never fails the voice or chat turn.

Reliability is persisted as a `data-transcriptReliability` message part with source, status, confidence, reason, signals and duration. `likely_garbled` turns are forced onto the ordinary reply lane and Sophie asks naturally for repetition instead of acting on the apparent meaning. `uncertain` turns carry caution into Sophie's prompt. Neither `uncertain` nor `likely_garbled` user text is mirrored into Honcho; the assistant clarification may still be mirrored. Logs expose both classification and memory eligibility.

The current application records complete voice notes rather than assembling streaming partials. The same source schema and duplicate-segment detector support `voice_stream` when that path is introduced, and tests cover duplicated streaming segments. There is currently no live streaming STT integration to modify.
