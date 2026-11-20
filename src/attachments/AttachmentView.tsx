import { useState } from 'react';
import { PLAYABLE } from '../../shared/attachments';
import type { EntryAttachment } from '../../shared/types';
import { Icon } from '../components/icons';
import { attachmentFacts, fileUrl, KIND_ICON, posterUrl } from './kinds';
import '../styles/attachments.css';

// An entry's attachment, to read: a video or a recording plays in place when the browser can play it; anything else,
// or one it cannot play, is a row to open or save. Nothing is fetched before it is played but a video's frame.
// Docs: /docs/product/features/attachments.md

function Save({ a }: { a: EntryAttachment }) {
  return (
    <a className="btn btn-ghost btn-icon" href={fileUrl(a.id, true)} download={a.name} aria-label={`下载 ${a.name}`}>
      <Icon name="download" size={18} />
    </a>
  );
}

function About({ a, note }: { a: EntryAttachment; note?: string }) {
  const opens = a.mime === 'application/pdf';
  return (
    <div className="att-main">
      {opens ? (
        <a className="att-name" href={fileUrl(a.id)} target="_blank" rel="noopener">
          {a.name}
        </a>
      ) : (
        <p className="att-name">{a.name}</p>
      )}
      <p className="small muted mono">{attachmentFacts(a)}</p>
      {note && <p className="small muted">{note}</p>}
    </div>
  );
}

function Caption({ a }: { a: EntryAttachment }) {
  return a.caption ? <figcaption>{a.caption}</figcaption> : null;
}

export default function AttachmentView({ a }: { a: EntryAttachment }) {
  const [failed, setFailed] = useState(false);
  const plays = a.kind !== 'file' && PLAYABLE.has(a.mime) && !failed;

  if (plays && a.kind === 'video') {
    return (
      <figure className="er-figure att-video">
        {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- an uploaded video or recording comes with no captions file; what the entry says of it is shown under it */}
        <video
          controls
          playsInline
          preload={a.poster ? 'none' : 'metadata'}
          poster={a.poster ? posterUrl(a.id) : undefined}
          src={fileUrl(a.id)}
          style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}
          onError={() => setFailed(true)}
        />
        <Caption a={a} />
        <div className="att-file att-under">
          <About a={a} />
          <Save a={a} />
        </div>
      </figure>
    );
  }
  return (
    <figure className="er-figure att-sound">
      <div className="att-file">
        <span className="att-thumb">
          <Icon name={KIND_ICON[a.kind]} size={24} />
        </span>
        <About a={a} note={failed ? '这个浏览器放不了，可以下载后打开' : undefined} />
        <Save a={a} />
      </div>
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- an uploaded video or recording comes with no captions file; what the entry says of it is shown under it */}
      {plays && <audio className="att-audio" controls preload="none" src={fileUrl(a.id)} onError={() => setFailed(true)} />}
      <Caption a={a} />
    </figure>
  );
}
