const MERCARI_STARTED_AT = Date.UTC(2013, 0, 1);

export function extractPublishedAtFromPhotoUrls(urls, itemId, now = Date.now()) {
  if (!Array.isArray(urls) || !/^m\d+$/.test(String(itemId))) return null;
  const pattern = new RegExp(`/item/detail/orig/photos/${itemId}_1\\.[a-z0-9]+\\?(\\d{10})(?:\\D|$)`, 'i');
  for (const url of urls) {
    const match = String(url ?? '').match(pattern);
    if (!match) continue;
    const timestamp = Number(match[1]) * 1000;
    if (timestamp >= MERCARI_STARTED_AT && timestamp <= now + 24 * 60 * 60 * 1000) {
      return new Date(timestamp).toISOString();
    }
  }
  return null;
}

export function formatJstMinute(value) {
  if (!value) return '无法取得';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '无法取得';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map(({ type, value: partValue }) => [type, partValue]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}
