import { Link } from 'wouter';

export default function NotFound() {
  return (
    <main className="page-narrow" style={{ paddingTop: 96 }}>
      <h1 className="display display-l">此处无图</h1>
      <p className="muted">这个地址没有内容。</p>
      <Link href="/" className="btn">回到图库</Link>
    </main>
  );
}
