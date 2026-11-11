import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../components/icons';
import {
  CAMERA_PROBLEM_TEXT,
  cameraProblemOf,
  cameraSupported,
  closeCamera,
  openCamera,
  shotFile,
  takeStill,
  thumbOf,
  type CameraProblem,
  type Facing
} from './camera';
import { handOver, phonePosition, trackPosition, type Tracked, type Tracker } from './capture';
import '../styles/camera.css';

interface Props {
  /** Closed, with how many photos were taken. */
  onClose: (taken: number) => void;
  /** Hand over to the system camera instead, with how many photos were taken here. Called from a tap, with this camera already released. */
  onSystemCamera: (taken: number) => void;
}

const WAITING: Tracked = { state: 'waiting' };

/** Where the photos will be placed, in a few words. */
function positionText(t: Tracked): string {
  if (t.state === 'refused') return '没有定位，照片不带位置';
  if (t.state === 'waiting') return '定位中…';
  return `位置精度约 ${t.fix.accuracy} 米`;
}

/**
 * The site's camera, full screen: a live picture, a shutter, and the photos taken go to the upload queue with the
 * phone's position (capture.ts). Several photos can be taken before leaving. The page stays in the foreground the
 * whole time, which is the point: see camera.ts.
 */
export default function CameraSheet({ onClose, onSystemCamera }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const taken = useRef(0);
  const [facing, setFacing] = useState<Facing>('environment');
  /** null while the camera starts */
  const [state, setState] = useState<'live' | CameraProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);
  const [missed, setMissed] = useState(false);
  /** the camera has answered once, with a picture or a problem */
  const [answered, setAnswered] = useState(false);
  const [tracker, setTracker] = useState<Tracker | null>(null);
  const left = useRef(false);

  const subscribe = useCallback((fn: () => void) => tracker?.subscribe(fn) ?? (() => {}), [tracker]);
  // the line of text, not the object: `now()` builds a new object each time, and a snapshot has to compare equal
  const positionLine = useSyncExternalStore(subscribe, () => positionText(tracker?.now() ?? WAITING));

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  // The camera: opened here, reopened when the other lens is chosen or the page comes back, released when it goes.
  useEffect(() => {
    let gone = false;
    const start = () => {
      if (stream.current) return;
      if (!cameraSupported()) {
        setState('unsupported');
        setAnswered(true);
        return;
      }
      setState(null);
      openCamera(facing).then(
        (s) => {
          if (gone || document.visibilityState === 'hidden') {
            closeCamera(s);
            return;
          }
          stream.current = s;
          const v = video.current;
          if (v) {
            v.srcObject = s;
            void v.play().catch(() => {});
          }
          setState('live');
          setAnswered(true);
        },
        (e: unknown) => {
          if (gone) return;
          setState(cameraProblemOf(e));
          setAnswered(true);
        }
      );
    };
    const stop = () => {
      closeCamera(stream.current);
      stream.current = null;
    };
    const onVisibility = () => (document.visibilityState === 'hidden' ? stop() : start());
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [facing, attempt]);

  // The phone's position, followed from the camera's first answer until this screen closes: the two permission
  // prompts then come one after the other, the camera's first.
  useEffect(() => {
    if (!answered) return;
    const t = trackPosition(phonePosition());
    setTracker(t);
    return () => t.stop();
  }, [answered]);

  const shoot = async () => {
    const v = video.current;
    const s = stream.current;
    if (busy || state !== 'live' || !v || !s) return;
    setBusy(true);
    setMissed(false);
    const at = Date.now();
    // where the phone is as the shutter is pressed
    const fix = tracker ? tracker.fixNow() : Promise.resolve(null);
    try {
      const blob = await takeStill(v, s);
      handOver({ file: shotFile(blob, at), at, fix });
      taken.current += 1;
      setCount(taken.current);
      setThumb(thumbOf(v));
    } catch {
      setMissed(true);
    } finally {
      setBusy(false);
    }
  };

  const leave = () => {
    if (left.current) return;
    left.current = true;
    onClose(taken.current);
  };

  const toSystemCamera = () => {
    if (left.current) return;
    left.current = true;
    // the system camera cannot open a camera this page still holds
    closeCamera(stream.current);
    stream.current = null;
    onSystemCamera(taken.current);
  };

  const problem = state !== null && state !== 'live' ? state : null;

  return (
    <dialog
      ref={dialog}
      className="cam"
      aria-label="拍照"
      // Esc or the phone's back button: leave the same way as the button does
      onCancel={leave}
      onClose={leave}
    >
      <video ref={video} className="cam-video" playsInline muted autoPlay data-mirror={facing === 'user'} hidden={state !== 'live'} />
      {busy && <div className="cam-flash" aria-hidden="true" />}

      <div className="cam-top">
        <button type="button" className="cam-btn" onClick={leave}>
          {count > 0 ? `完成（${count}）` : '关闭'}
        </button>
        <p className="cam-status" role="status">
          {missed ? '没拍下来，请再试一次' : state === 'live' ? positionLine : ''}
        </p>
        <button
          type="button"
          className="cam-btn cam-flip"
          aria-label={facing === 'environment' ? '换到前置镜头' : '换到后置镜头'}
          disabled={state !== 'live' || busy}
          onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))}
        >
          <Icon name="flip" size={22} />
        </button>
      </div>

      {state === null && (
        <p className="cam-center" role="status">
          正在打开相机…
        </p>
      )}
      {problem && (
        <div className="cam-center" role="alert">
          <p>{CAMERA_PROBLEM_TEXT[problem]}</p>
          <div className="cam-center-actions">
            {problem !== 'unsupported' && (
              <button type="button" className="cam-btn cam-btn-line" onClick={() => setAttempt((n) => n + 1)}>
                重试
              </button>
            )}
            <button type="button" className="cam-btn cam-btn-line" onClick={toSystemCamera}>
              改用系统相机
            </button>
          </div>
        </div>
      )}

      <div className="cam-bottom">
        <div className="cam-last">{thumb && <img src={thumb} alt={`已拍 ${count} 张，最近一张`} width={48} height={48} />}</div>
        <button type="button" className="cam-shutter" aria-label="拍摄" disabled={state !== 'live' || busy} onClick={() => void shoot()} />
        <button type="button" className="cam-btn cam-system" onClick={toSystemCamera} hidden={!!problem}>
          系统相机
        </button>
      </div>
    </dialog>
  );
}
