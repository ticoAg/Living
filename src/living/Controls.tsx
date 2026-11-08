import type { CSSProperties, Ref } from 'react';
import { Icon } from '../components/icons';

interface Props {
  /** zero-based position and playlist length */
  index: number;
  count: number;
  paused: boolean;
  settingsOpen: boolean;
  /** auto-hidden: invisible and click-through, but still reachable with the keyboard */
  hidden: boolean;
  fullscreenSupported: boolean;
  fullscreenActive: boolean;
  /** progress line: seconds per photo, a key that restarts it on every change, and whether it runs */
  everySec: number;
  runKey: string;
  running: boolean;
  settingsRef: Ref<HTMLButtonElement>;
  onPrev: () => void;
  onToggle: () => void;
  onNext: () => void;
  onSettings: () => void;
  onFullscreen: () => void;
  onExit: () => void;
  /** the pointer is over the bar, or keyboard focus is inside it: keep it up */
  onEngage: (kind: 'pointer' | 'focus', engaged: boolean) => void;
}

/** True when focus arrived by keyboard (or when the browser cannot tell). */
function keyboardFocus(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return true;
  }
}

/** Bottom-centre pill (prev, play/pause, next, counter | settings, fullscreen, exit) and the 2 px progress line. */
export default function Controls(p: Props) {
  const canStep = p.count > 1;
  return (
    <>
      <div
        className="lv-bar"
        role="group"
        aria-label="播放控制"
        data-hidden={p.hidden}
        onPointerEnter={(e) => e.pointerType !== 'touch' && p.onEngage('pointer', true)}
        onPointerLeave={() => p.onEngage('pointer', false)}
        // Only keyboard focus pins the bar; a button focused by a mouse click must not keep it up forever.
        onFocus={(e) => keyboardFocus(e.target) && p.onEngage('focus', true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && p.onEngage('focus', false)}
      >
        <button type="button" className="lv-btn" aria-label="上一张" disabled={!canStep} onClick={p.onPrev}>
          <Icon name="left" size={20} />
        </button>
        <button type="button" className="lv-btn lv-btn-main" aria-label={p.paused ? '继续播放' : '暂停'} disabled={p.count < 1} onClick={p.onToggle}>
          <Icon name={p.paused ? 'play' : 'pause'} size={18} />
        </button>
        <button type="button" className="lv-btn" aria-label="下一张" disabled={!canStep} onClick={p.onNext}>
          <Icon name="right" size={20} />
        </button>
        <span className="lv-counter" aria-label={p.count ? `第 ${p.index + 1} 张，共 ${p.count} 张` : '没有照片'}>
          {p.count ? `${p.index + 1} / ${p.count}` : '0 / 0'}
        </span>
        <span className="lv-bar-sep" aria-hidden="true" />
        <button
          ref={p.settingsRef}
          type="button"
          className="lv-btn"
          aria-label="设置"
          aria-expanded={p.settingsOpen}
          aria-controls="lv-drawer"
          data-on={p.settingsOpen}
          onClick={p.onSettings}
        >
          <Icon name="sliders" size={20} />
        </button>
        {p.fullscreenSupported && (
          <button type="button" className="lv-btn lv-btn-fs" aria-label={p.fullscreenActive ? '退出全屏' : '全屏'} data-on={p.fullscreenActive} onClick={p.onFullscreen}>
            <Icon name="expand" size={18} />
          </button>
        )}
        <button type="button" className="lv-btn" aria-label="退出 Living" onClick={p.onExit}>
          <Icon name="close" size={18} strokeWidth={1.9} />
        </button>
      </div>
      <div className="lv-progress" data-hidden={p.hidden} aria-hidden="true">
        <div
          key={p.runKey}
          className="lv-progress-bar"
          data-running={p.running && p.count > 1}
          style={{ '--lv-every': `${p.everySec}s` } as CSSProperties}
        />
      </div>
    </>
  );
}
