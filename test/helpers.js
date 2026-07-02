// $where busy-waits per document (mongo evaluates it document-by-document),
// making the query reliably slower than a small timeout, so the deadline fires.
export const SLOW_WHERE =
  'var t = Date.now(); while (Date.now() - t < 120) {} return true;';
