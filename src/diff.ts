// Word-level diff for the conflict compare screen (longest common subsequence).

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

// Thai has no spaces between words, so split by real word boundaries where
// the browser can; otherwise by spaces.
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("th", { granularity: "word" }) : null;
const tokens = (s: string) =>
  segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : s.split(/(\s+)/).filter(Boolean);

/** Above this many table cells (rows × columns) the middle is shown as one change, not word by word. */
const MAX_CELLS = 4_000_000;

export function wordDiff(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  let a = tokens(before);
  let b = tokens(after);
  // Shared start and end need no table; most conflicts differ in a small middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  push("same", a.slice(0, start).join(""));
  const tail = a.slice(a.length - end).join("");
  a = a.slice(start, a.length - end);
  b = b.slice(start, b.length - end);

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    push("removed", a.join(""));
    push("added", b.join(""));
  } else {
    const width = b.length + 1;
    // lcs[i * width + j] = length of the common subsequence of a[i..] and b[j..]
    const lcs = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        lcs[i * width + j] =
          a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        push("same", a[i]);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) push("removed", a[i++]);
      else push("added", b[j++]);
    }
    while (i < a.length) push("removed", a[i++]);
    while (j < b.length) push("added", b[j++]);
  }
  push("same", tail);
  return parts;
}
