import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/**
 * Mirrors the windowing maths in src/components/EpisodeGrid.tsx.
 *
 * The component itself needs a DOM + ResizeObserver, so the pure geometry is
 * reproduced here and asserted. The two constants below are duplicated on
 * purpose and asserted against the component's values by the "constants match
 * the component" test, which reads the source file.
 */
const ROW_HEIGHT = 46;
const OVERSCAN_ROWS = 6;
const WINDOWING_THRESHOLD = 120;

interface PlanInput {
  count: number;
  reversed?: boolean;
  scrollTop?: number;
  clientHeight?: number;
  columns?: number;
}

function plan(input: PlanInput) {
  const {
    count,
    reversed = false,
    scrollTop = 0,
    clientHeight = 400,
    columns = 6,
  } = input;

  const windowed = count > WINDOWING_THRESHOLD;
  const visibleRows = Math.ceil(clientHeight / ROW_HEIGHT);
  const range = {
    start: Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS),
    end: Math.floor(scrollTop / ROW_HEIGHT) + visibleRows + OVERSCAN_ROWS,
  };

  const totalRows = Math.ceil(count / columns);
  const firstRow = windowed ? Math.floor(range.start / columns) : 0;
  const lastRow = windowed
    ? Math.min(totalRows, Math.ceil(range.end / columns))
    : totalRows;

  const indexes: number[] = [];
  for (let row = firstRow; row < lastRow; row++) {
    for (let col = 0; col < columns; col++) {
      const displayIndex = row * columns + col;
      if (displayIndex >= count) break;
      indexes.push(reversed ? count - 1 - displayIndex : displayIndex);
    }
  }

  return {
    windowed,
    mounted: indexes.length,
    spacerTop: windowed ? firstRow * ROW_HEIGHT : 0,
    spacerBottom: windowed
      ? Math.max(0, (totalRows - lastRow) * ROW_HEIGHT)
      : 0,
    totalRows,
    indexes,
  };
}

describe('EpisodeGrid windowing', () => {
  it('does not window small lists', () => {
    assert.equal(plan({ count: 30 }).windowed, false);
    assert.equal(plan({ count: WINDOWING_THRESHOLD }).windowed, false);
    assert.equal(plan({ count: 30 }).mounted, 30);
  });

  it('windows lists past the threshold', () => {
    assert.equal(plan({ count: WINDOWING_THRESHOLD + 1 }).windowed, true);
    assert.ok(plan({ count: 1000 }).mounted < 60);
  });

  it('keeps the mounted count bounded at every scroll position', () => {
    let worst = 0;
    for (let t = 0; t <= 1000 * ROW_HEIGHT; t += ROW_HEIGHT) {
      worst = Math.max(worst, plan({ count: 1000, scrollTop: t }).mounted);
    }
    assert.ok(worst < 70, `window grew to ${worst} cells`);
  });

  it('reserves scroll height with spacers', () => {
    const mid = plan({ count: 1000, scrollTop: 2000 });
    assert.ok(
      mid.spacerTop > 0,
      'top spacer should reserve scrolled-past rows',
    );
    assert.ok(
      mid.spacerBottom > 0,
      'bottom spacer should reserve remaining rows',
    );
  });

  it('reaches every episode when scrolling, forward and reversed', () => {
    for (const count of [200, 500, 1000]) {
      for (const reversed of [false, true]) {
        const seen = new Set<number>();
        for (let t = 0; t <= count * ROW_HEIGHT; t += ROW_HEIGHT) {
          for (const i of plan({ count, reversed, scrollTop: t }).indexes) {
            seen.add(i);
          }
        }
        const missing: number[] = [];
        for (let i = 0; i < count; i++) if (!seen.has(i)) missing.push(i);
        assert.deepEqual(
          missing,
          [],
          `${count} episodes (reversed=${reversed}) left ${missing.length} unreachable`,
        );
      }
    }
  });

  it('maps reversal to the correct original index', () => {
    assert.equal(plan({ count: 8, columns: 4 }).indexes[0], 0);
    assert.equal(plan({ count: 8, columns: 4, reversed: true }).indexes[0], 7);
  });

  it('handles a column count that does not divide the list', () => {
    // 7 items in 3 columns -> 3 rows, last row has 1 item.
    const r = plan({ count: 7, columns: 3 });
    assert.equal(r.totalRows, 3);
    assert.ok(r.mounted <= 7);
    for (const i of r.indexes) assert.ok(i >= 0 && i < 7);
  });

  it('matches the constants declared in the component', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../src/components/EpisodeGrid.tsx', import.meta.url),
      'utf8',
    );
    const grab = (name: string) => {
      const m = new RegExp(`const ${name} = ([0-9_]+)`).exec(src);
      return m ? Number(m[1].replace(/_/g, '')) : null;
    };
    assert.equal(grab('ROW_HEIGHT'), ROW_HEIGHT);
    assert.equal(grab('OVERSCAN_ROWS'), OVERSCAN_ROWS);
    assert.equal(grab('WINDOWING_THRESHOLD'), WINDOWING_THRESHOLD);
  });
});
