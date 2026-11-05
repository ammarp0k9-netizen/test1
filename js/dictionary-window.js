(function attachDictionaryWindow(root) {
  'use strict';

  // Prefix heights support variable-size cards without scanning the dictionary
  // on scroll. Measurements and offset lookups both take O(log n).
  function createHeightIndex(count, estimate = 100) {
    const size = Math.max(0, Math.floor(Number(count) || 0));
    const initial = Math.max(1, Number(estimate) || 100);
    const heights = new Float64Array(size).fill(initial);
    const tree = new Float64Array(size + 1);
    for (let i = 1; i <= size; i += 1) tree[i] = (i & -i) * initial;
    function offset(index) {
      let sum = 0;
      for (let i = Math.max(0, Math.min(size, index)); i > 0; i -= i & -i) sum += tree[i];
      return sum;
    }
    function measure(index, height) {
      if (index < 0 || index >= size || !Number.isFinite(height) || height <= 0) return false;
      const delta = height - heights[index];
      if (Math.abs(delta) < 0.5) return false;
      heights[index] = height;
      for (let i = index + 1; i <= size; i += i & -i) tree[i] += delta;
      return true;
    }
    function indexAt(position) {
      if (!size) return 0;
      let index = 0, sum = 0, bit = 1;
      while (bit * 2 <= size) bit *= 2;
      for (; bit; bit >>= 1) {
        const next = index + bit;
        if (next <= size && sum + tree[next] <= Math.max(0, position)) {
          index = next;
          sum += tree[next];
        }
      }
      return Math.min(size - 1, index);
    }
    function range(position, viewport, overscan = 10) {
      const first = indexAt(position);
      const last = indexAt(Math.max(0, position) + Math.max(0, viewport));
      return { start: Math.max(0, first - overscan), end: Math.min(size, last + overscan + 1) };
    }
    return { size, offset, measure, indexAt, range };
  }
  root.LootLinguaDictionaryWindow = Object.freeze({ createHeightIndex });
})(typeof window !== 'undefined' ? window : globalThis);
