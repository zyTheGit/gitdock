import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useVirtualizer } from '@tanstack/react-virtual';
import { parseDiff, Diff, Hunk } from 'react-diff-view';

const ROW_COUNT = 10000;
const ROW_HEIGHT = 28;
const bootAt = performance.now();

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const frames = async (n: number) => {
  for (let i = 0; i < n; i += 1) await frame();
};

function makePatch(lines: number): string {
  const body: string[] = [
    'diff --git a/big.txt b/big.txt',
    '--- a/big.txt',
    '+++ b/big.txt',
    `@@ -0,0 +1,${lines} @@`,
  ];
  for (let i = 0; i < lines; i += 1) {
    body.push(`+line ${String(i).padStart(5, '0')} payload-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa`);
  }
  return body.join('\n');
}

function renderDiff(patch: string) {
  const file = parseDiff(patch)[0];
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-10000px';
  host.style.width = '900px';
  document.body.appendChild(host);
  const root = createRoot(host);
  const start = performance.now();
  flushSync(() => {
    root.render(
      <Diff viewType="unified" diff={file} hunks={file.hunks}>
        {(hunks) =>
          hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)
        }
      </Diff>,
    );
  });
  const ms = performance.now() - start;
  const nodes = host.querySelectorAll('*').length;
  root.unmount();
  host.remove();
  return { parseAndRenderMs: Number(ms.toFixed(1)), domNodes: nodes, hunks: file.hunks.length };
}

export default function App() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: ROW_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useEffect(() => {
    let canceled = false;
    const run = async () => {
      await frames(2);
      if (canceled) return;
      const mountMs = Number((performance.now() - bootAt).toFixed(1));
      const initialItems = virtualizer.getVirtualItems().length;
      const initialDomRows = document.querySelectorAll('[data-row]').length;

      const midStart = performance.now();
      virtualizer.scrollToIndex(5000, { align: 'start' });
      await frames(4);
      const midMs = Number((performance.now() - midStart).toFixed(1));
      const midItems = virtualizer.getVirtualItems().length;
      const midDomRows = document.querySelectorAll('[data-row]').length;
      const midScrollTop = scrollRef.current?.scrollTop ?? 0;

      const endStart = performance.now();
      virtualizer.scrollToIndex(9999, { align: 'end' });
      await frames(4);
      const endMs = Number((performance.now() - endStart).toFixed(1));
      const endItems = virtualizer.getVirtualItems().length;
      const endDomRows = document.querySelectorAll('[data-row]').length;

      const totalStart = performance.now();
      virtualizer.scrollToIndex(0, { align: 'start' });
      await frames(2);
      const backMs = Number((performance.now() - totalStart).toFixed(1));

      const patch5000 = makePatch(5000);
      const parseStart = performance.now();
      parseDiff(patch5000);
      const parse5000Ms = Number((performance.now() - parseStart).toFixed(1));
      let diff5000: unknown;
      let diff500: unknown;
      let diffError = '';
      try {
        diff5000 = renderDiff(patch5000);
        diff500 = renderDiff(makePatch(500));
      } catch (error) {
        diffError = String((error as Error)?.stack ?? error);
      }

      const result = {
        env: navigator.userAgent,
        rows: ROW_COUNT,
        rowHeight: ROW_HEIGHT,
        virtualList: {
          mountMs,
          initialItems,
          initialDomRows,
          scrollToMiddleMs: midMs,
          middleItems: midItems,
          middleDomRows: midDomRows,
          middleScrollTop: midScrollTop,
          scrollToEndMs: endMs,
          endItems,
          endDomRows,
          scrollBackMs: backMs,
        },
        diff: {
          parse5000Ms,
          render5000: diff5000,
          render500: diff500,
          error: diffError,
        },
      };
      const pre = document.getElementById('result');
      if (pre) pre.textContent = JSON.stringify(result, null, 2);
      document.title = 'V3-POC-DONE';
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [virtualizer]);

  return (
    <div>
      <h1 style={{ fontFamily: 'sans-serif', fontSize: 16 }}>V3 虚拟列表 POC（10000 行）</h1>
      <div
        ref={scrollRef}
        id="scroller"
        style={{ height: 600, width: 900, overflow: 'auto', border: '1px solid #999', position: 'relative' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-row={item.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: item.size,
                transform: `translateY(${item.start}px)`,
                font: '13px monospace',
                lineHeight: `${ROW_HEIGHT}px`,
                paddingLeft: 8,
              }}
            >
              row {item.index} / 9999
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
