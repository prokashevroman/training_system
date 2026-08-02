import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Microphone capture (brief 7.1).
 *
 * Audio is held in memory for exactly as long as it takes to upload it and is
 * never written to storage — the brief forbids retaining it by default. The
 * recorder enforces its own duration and size ceilings client-side so a stuck
 * recording cannot silently become a large upload, and reports permission
 * failures as a specific message rather than a generic error.
 */

/** The brief's initial application-level ceiling. */
export const MAX_RECORDING_SECONDS = 300;
/** Roughly 10 MB; Opus at 32 kbps needs about 1.2 MB for five minutes. */
export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;

export type RecorderState = "idle" | "recording" | "stopping" | "ready" | "error";

export interface RecorderError {
  kind: "unsupported" | "permission" | "insecure" | "too_long" | "too_large" | "failed";
  message: string;
}

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

/**
 * True when the browser can record at all. Safari needs a secure context, and
 * `MediaRecorder` is absent on some older mobile browsers, so both are checked
 * before the UI offers a record button.
 */
export function detectRecorderSupport(): RecorderError | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return {
      kind: "insecure",
      message: "Recording needs HTTPS. Open the app over a secure connection and try again.",
    };
  }
  if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      kind: "unsupported",
      message: "This browser cannot record audio. Use manual entry instead.",
    };
  }
  return null;
}

/** Picks a container the browser actually supports, preferring compact Opus. */
function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const [recording, setRecording] = useState<Recording | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef(0);
  const cancelledRef = useRef(false);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  // Releasing the microphone on unmount matters: leaving it open keeps the
  // browser's recording indicator lit after the user has navigated away.
  useEffect(() => releaseStream, [releaseStream]);

  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_RECORDING_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => window.clearInterval(id);
  }, [state]);

  const start = useCallback(async () => {
    const unsupported = detectRecorderSupport();
    if (unsupported) {
      setError(unsupported);
      setState("error");
      return;
    }

    setError(null);
    setRecording(null);
    chunksRef.current = [];
    cancelledRef.current = false;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError({
        kind: "permission",
        message:
          "Microphone access was refused. Allow it in your browser's site settings, or use manual entry.",
      });
      setState("error");
      return;
    }

    streamRef.current = stream;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
      releaseStream();

      if (cancelledRef.current) {
        chunksRef.current = [];
        setState("idle");
        setSeconds(0);
        return;
      }

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];

      if (blob.size > MAX_RECORDING_BYTES) {
        setError({
          kind: "too_large",
          message: "That recording is too large to send. Try a shorter one.",
        });
        setState("error");
        return;
      }

      setRecording({ blob, mimeType: recorder.mimeType || "audio/webm", durationSeconds: elapsed });
      setState("ready");
    };

    recorder.onerror = () => {
      releaseStream();
      setError({ kind: "failed", message: "Recording failed. Try again or use manual entry." });
      setState("error");
    };

    startedAtRef.current = Date.now();
    setSeconds(0);
    recorder.start();
    setState("recording");
  }, [releaseStream]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      setState("stopping");
      recorderRef.current.stop();
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    } else {
      releaseStream();
      setState("idle");
      setSeconds(0);
      setRecording(null);
    }
  }, [releaseStream]);

  const reset = useCallback(() => {
    setState("idle");
    setSeconds(0);
    setError(null);
    setRecording(null);
  }, []);

  return { state, seconds, error, recording, start, stop, cancel, reset };
}

/** `m:ss`, for the visible timer the brief requires. */
export function formatTimer(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
