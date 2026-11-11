import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useLocation } from 'wouter';
import { handOver, startLocating, type Locator } from '../studio/capture';
import { Icon } from './icons';

const geolocation = () => (typeof navigator === 'undefined' ? undefined : navigator.geolocation);

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
 * The camera button in the middle of the phone's bottom bar: opens the system camera, then puts the photo in the
 * upload queue together with the phone's position, for the case its file carries none (capture.ts).
 * The position is asked for at the tap when the site already has permission, so GPS warms up while the photo is
 * framed; otherwise only once the photo is back, so the permission prompt does not appear under the camera.
 */
export default function CaptureButton() {
  const [path, navigate] = useLocation();
  const granted = useLocationGranted();
  const input = useRef<HTMLInputElement>(null);
  const locator = useRef<Locator | null>(null);

  // the camera was closed without a photo
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

  const onOpen = () => {
    locator.current?.stop();
    locator.current = granted ? startLocating(geolocation()) : null;
  };

  const onShot = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const loc = locator.current ?? (file ? startLocating(geolocation()) : null);
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
    <label className="nav-capture">
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        aria-label="拍照"
        onClick={onOpen}
        onChange={onShot}
      />
      <span className="nav-capture-disc">
        <Icon name="camera" size={22} />
      </span>
    </label>
  );
}
