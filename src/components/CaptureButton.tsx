import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'wouter';
import { handOver, phonePosition, startLocating, type Locator } from '../studio/capture';
import { Icon } from './icons';

const CameraSheet = lazy(() => import('../studio/CameraSheet'));

/** Whether the site may already read the phone's position: asking then shows no prompt. */
function useLocationGranted(): boolean {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    let status: PermissionStatus | undefined;
    let gone = false;
    const read = () => setGranted(status?.state === 'granted');
    navigator.permissions?.query({ name: 'geolocation' }).then(
      (s) => {
        if (gone) return;
        status = s;
        read();
        s.addEventListener('change', read);
      },
      () => {}
    );
    return () => {
      gone = true;
      status?.removeEventListener('change', read);
    };
  }, []);
  return granted;
}

/**
 * The camera button in the middle of the phone's bottom bar. It opens the site's own camera (CameraSheet), which
 * keeps the page in the foreground; the photos taken there go to the upload queue with the phone's position, and
 * leaving the camera with photos taken opens the upload page.
 *
 * The system camera stays available from inside that screen (the hidden `capture` input here). It takes better
 * pictures, but a phone short of memory closes the browser behind it and the photo is lost. For that route the
 * position is asked for at the tap when the site already has permission, so GPS warms up while the photo is framed;
 * otherwise only once the photo is back, so the permission prompt does not appear under the camera.
 */
export default function CaptureButton() {
  const [path, navigate] = useLocation();
  const granted = useLocationGranted();
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const locator = useRef<Locator | null>(null);

  // the system camera was closed without a photo
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const cancel = () => {
      locator.current?.stop();
      locator.current = null;
    };
    el.addEventListener('cancel', cancel);
    return () => {
      el.removeEventListener('cancel', cancel);
      cancel();
    };
  }, []);

  const close = (taken: number) => {
    setOpen(false);
    if (taken > 0 && path !== '/upload') navigate('/upload');
  };

  const onSystemOpen = () => {
    locator.current?.stop();
    locator.current = granted ? startLocating(phonePosition()) : null;
  };

  const onSystemShot = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const loc = locator.current ?? (file ? startLocating(phonePosition()) : null);
    locator.current = null;
    if (!file || !loc) {
      loc?.stop();
      return;
    }
    loc.settle();
    handOver({ file, at: Date.now(), fix: loc.fix });
    if (path !== '/upload') navigate('/upload');
  };

  return (
    <>
      <button type="button" className="nav-capture" aria-label="拍照" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="nav-capture-disc">
          <Icon name="camera" size={22} />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        aria-label="系统相机"
        onClick={onSystemOpen}
        onChange={onSystemShot}
      />
      {open &&
        createPortal(
          <Suspense fallback={null}>
            <CameraSheet
              onClose={close}
              onSystemCamera={(taken) => {
                // still inside the tap that asked for it: browsers open a file input only then
                input.current?.click();
                close(taken);
              }}
            />
          </Suspense>,
          document.body
        )}
    </>
  );
}
