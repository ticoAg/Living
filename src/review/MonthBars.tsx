// Entries a month over a long span, as columns on one baseline: the busiest month carries its number, the ends of the
// span are named under it, and pointing at a month tells its count. Docs: /docs/product/features/projects.md

const ym = (m: string) => `${m.slice(0, 4)}年${+m.slice(5, 7)}月`;

/** height of the busiest month's column, px */
const TALL = 88;

export default function MonthBars({ data, label }: { data: readonly { month: string; count: number }[]; label: string }) {
  const max = Math.max(0, ...data.map((d) => d.count));
  const peak = max > 0 ? data.findIndex((d) => d.count === max) : -1;
  const last = data.length - 1;
  // a tip near either end opens inward, so it stays over the chart
  const edge = Math.max(3, data.length / 4);
  return (
    <figure className="mb">
      <ol className="mb-cols" aria-label={label}>
        {data.map((d, i) => {
          const tip = `${ym(d.month)}：${d.count} 条记录`;
          return (
            <li key={d.month} className="mb-col" data-tip={tip} data-edge={i < edge ? 'start' : i > last - edge ? 'end' : undefined}>
              {i === peak && (
                <span className="mb-peak mono" aria-hidden="true">
                  {d.count}
                </span>
              )}
              {d.count > 0 && <span className="mb-bar" style={{ height: Math.max(2, Math.round((d.count / max) * TALL)) }} />}
              <span className="visually-hidden">{tip}</span>
            </li>
          );
        })}
      </ol>
      <figcaption className="mb-ends mono" aria-hidden="true">
        <span>{data[0] ? ym(data[0].month) : ''}</span>
        <span>{data[last] ? ym(data[last].month) : ''}</span>
      </figcaption>
    </figure>
  );
}
