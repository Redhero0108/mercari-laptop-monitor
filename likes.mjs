export function parseLikeCount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).normalize('NFKC').trim();
  const match = text.match(/^([\d,]+)$/);
  if (match) return Number(match[1].replaceAll(',', ''));
  if (/いいね|イイね/i.test(text)) return 0;
  return null;
}
