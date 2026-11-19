import { useCallback, useEffect, useRef, useState } from 'react';
import { canRecord, recordError, recordingFormat, recordingName } from './recorder';

// Recording from the microphone: `start` asks for it, `stop` hands the recording on, `cancel` drops it. The microphone
// is let go as soon as a recording ends, and when the page that records goes.

export type RecorderState = { kind: 'idle' } | { kind: 'starting' } | { kind: 'on'; since: number } | { kind: 'error'; text: string };

interface Live {
  rec: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  began: Date;
  since: number;
  keep: boolean;
}

const release = (stream: MediaStream) => stream.getTracks().forEach((t) => t.stop());

/** `onDone` gets the recording as a file, and how many seconds it ran. */
export function useRecorder(onDone: (file: File, seconds: number) => void) {
  const [state, setState] = useState<RecorderState>({ kind: 'idle' });
  const live = useRef<Live | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const start = useCallback(async () => {
    if (live.current) return;
    if (!canRecord()) {
      setState({ kind: 'error', text: recordError(null) });
      return;
    }
    setState({ kind: 'starting' });
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setState({ kind: 'error', text: recordError(e) });
      return;
    }
    const type = recordingFormat((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    } catch (e) {
      release(stream);
      setState({ kind: 'error', text: recordError(e) });
      return;
    }
    const l: Live = { rec, stream, chunks: [], began: new Date(), since: Date.now(), keep: true };
    live.current = l;
    rec.ondataavailable = (e) => {
      if (e.data.size) l.chunks.push(e.data);
    };
    rec.onstop = () => {
      release(stream);
      if (live.current === l) live.current = null;
      setState({ kind: 'idle' });
      if (!l.keep || !l.chunks.length) return;
      const mime = rec.mimeType || type || 'audio/webm';
      done.current(new File(l.chunks, recordingName(l.began, mime), { type: mime }), (Date.now() - l.since) / 1000);
    };
    // in pieces of a second: a recording stopped by a closed tab still has all but its last second
    rec.start(1000);
    setState({ kind: 'on', since: l.since });
  }, []);

  const end = useCallback((keep: boolean) => {
    const l = live.current;
    if (!l) return;
    l.keep = keep;
    if (l.rec.state !== 'inactive') l.rec.stop();
    else release(l.stream);
  }, []);

  useEffect(() => () => end(false), [end]);

  return {
    state,
    start: () => void start(),
    stop: () => end(true),
    cancel: () => end(false),
    dismiss: () => setState((s) => (s.kind === 'error' ? { kind: 'idle' } : s))
  };
}
