import { Icon } from '../components/icons';

interface Props {
  /** the question is showing */
  confirm: boolean;
  deleting: boolean;
  onConfirmChange: (confirm: boolean) => void;
  onDelete: () => void;
}

/** The editor's 删除主题 section: a button, then a confirmation in place of it. */
export default function DeleteSection({ confirm, deleting, onConfirmChange, onDelete }: Props) {
  return (
    <section className="ed-sec ed-danger" aria-labelledby="ed-del">
      <h2 id="ed-del" className="ed-h">
        删除主题
      </h2>
      {!confirm ? (
        <div>
          <button id="th-delete" type="button" className="btn btn-danger" onClick={() => onConfirmChange(true)}>
            <Icon name="trash" size={18} />
            删除主题
          </button>
        </div>
      ) : (
        <div className="notice ed-confirm" role="alert">
          <p>确定删除这个主题吗？照片不会被删除，但主题和其中的文字无法恢复。</p>
          <div className="row">
            <button type="button" className="btn btn-danger" disabled={deleting} onClick={onDelete}>
              {deleting ? '删除中…' : '确认删除'}
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              autoFocus
              disabled={deleting}
              onClick={() => {
                onConfirmChange(false);
                requestAnimationFrame(() => document.getElementById('th-delete')?.focus());
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
