// 内部の理由キー（reasons）は機能上の鍵として中国語のまま保持する。
// 画面表示時にだけ日文へ変換するための対応表。
const REASON_JA = {
  '32GB内存': '32GBメモリ',
  '512GB存储': '512GBストレージ',
  '1TB存储': '1TBストレージ',
  '未确认SSD': 'SSD未確認',
  '严重故障/锁机风险': '深刻な故障・ロックのリスク',
  '不是目标Windows笔记本': '対象外のWindowsノートPC',
  '外观或屏幕有缺陷': '外観・画面に難あり',
  '有瑕疵说明': '難ありの記載あり',
  '电池状态较差': 'バッテリー状態が不良',
  '电池描述较好': 'バッテリー状態が良好',
  '商务本系列': 'ビジネスシリーズ',
  '非指定商务系列': '指定外のビジネスシリーズ',
  '商品状态良好': '商品状態が良好',
  '价格合理': '価格が妥当',
};

// reasons を画面表示用の日文に変換する（未知の鍵は原文のまま）。
function reasonsToJa(reasons) {
  return (Array.isArray(reasons) ? reasons : []).map((reason) => {
    if (reason.startsWith('指定系列：')) return `指定シリーズ：${reason.slice('指定系列：'.length).trim()}`;
    return REASON_JA[reason] ?? reason;
  });
}

export function memorySpecConflict(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (!reasons.includes('32GB内存')) return { conflict: false, label: '' };

  const title = String(entry?.title ?? '').normalize('NFKC');
  const explicit32GB = /(?<!\d)32\s*(?:gb|g)(?![a-z])/i.test(title);
  const dual16GB = /(?<!\d)16\s*(?:gb|g)\s*(?:[x×*]\s*2|\+\s*16\s*(?:gb|g))/i.test(title);
  if (explicit32GB || dual16GB) return { conflict: false, label: '' };

  const mentionedSizes = [...title.matchAll(/(?<!\d)(4|8|12|16|24|48|64)\s*(?:gb|g)(?![a-z])/gi)]
    .map((match) => Number(match[1]));
  const conflictingSize = mentionedSizes[0];
  return Number.isFinite(conflictingSize)
    ? { conflict: true, label: `タイトル${conflictingSize}GB / 検出32GB・要確認` }
    : { conflict: false, label: '' };
}

function detectedStorage(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (reasons.includes('1TB存储')) return { value: 1024, label: '1TB' };
  if (reasons.includes('512GB存储')) return { value: 512, label: '512GB' };
  return null;
}

function titleStorage(entry) {
  const title = String(entry?.title ?? '').normalize('NFKC');
  if (/(?<!\d)1\s*tb(?![a-z])/i.test(title)) return { value: 1024, label: '1TB' };
  const match = title.match(/(?<!\d)(128|256|512)\s*(?:gb|g)(?![a-z])/i);
  return match ? { value: Number(match[1]), label: `${match[1]}GB` } : null;
}

export function storageSpecConflict(entry) {
  const titleValue = titleStorage(entry);
  const detectedValue = detectedStorage(entry);
  if (!titleValue || !detectedValue || titleValue.value === detectedValue.value) {
    return { conflict: false, label: '' };
  }
  return {
    conflict: true,
    label: `タイトル${titleValue.label} / 検出${detectedValue.label}・要確認`,
  };
}

export function specConfidence(entry) {
  const memoryConflict = memorySpecConflict(entry);
  const storageConflict = storageSpecConflict(entry);
  if (memoryConflict.conflict || storageConflict.conflict) {
    return { level: 'conflict', label: 'スペック矛盾', detail: memoryConflict.label || storageConflict.label };
  }

  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  const hasMemory = reasons.includes('32GB内存');
  const storage = detectedStorage(entry);
  const hasSSD = Boolean(storage) && !reasons.includes('未确认SSD');
  if (!hasMemory || !storage || !hasSSD) {
    return { level: 'unknown', label: '情報不足', detail: '32GBメモリとSSDストレージが未完全確認' };
  }

  const title = String(entry?.title ?? '').normalize('NFKC');
  const titleHas32GB = /(?<!\d)32\s*(?:gb|g)(?![a-z])/i.test(title)
    || /(?<!\d)16\s*(?:gb|g)\s*(?:[x×*]\s*2|\+\s*16\s*(?:gb|g))/i.test(title);
  const titleStorageValue = titleStorage(entry);
  const titleHasSSD = /ssd/i.test(title);
  if (titleHas32GB && titleStorageValue?.value === storage.value && titleHasSSD) {
    return { level: 'title', label: 'タイトル確認', detail: 'タイトルと検出結果が一致' };
  }
  return { level: 'detail', label: '詳細確認', detail: 'バックグラウンド詳細で確認済み。タイトルに全スペックが未記載' };
}

export function priceTrend(entry) {
  const history = Array.isArray(entry?.priceHistory)
    ? entry.priceHistory.filter((point) => Number.isFinite(point?.value) && Number.isFinite(Date.parse(point?.at)))
    : [];
  if (history.length < 2) return null;
  const currentPoint = history.at(-1);
  const previousPoint = [...history].reverse().find((point) => point.value !== currentPoint.value);
  if (!previousPoint) return null;
  return {
    previous: previousPoint.value,
    current: currentPoint.value,
    delta: currentPoint.value - previousPoint.value,
    changedAt: currentPoint.at,
  };
}

export function recentChangeBadges(entry, nowMs = Date.now()) {
  const cutoff = nowMs - 24 * 60 * 60 * 1000;
  const isRecent = (value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs;
  };
  const badges = [];
  if (isRecent(entry?.firstSeenAt)) {
    badges.push({ kind: 'new', label: '新着', detail: '直近24時間で初めて発見' });
  }
  const trend = priceTrend(entry);
  if (trend?.delta < 0 && isRecent(trend.changedAt)) {
    badges.push({
      kind: 'price-down',
      label: '値下げ',
      detail: `前回より ¥${Math.abs(trend.delta).toLocaleString('ja-JP')} 値下げ`,
    });
  }
  const likes = Array.isArray(entry?.likeHistory)
    ? entry.likeHistory.filter((point) => Number.isInteger(point?.value) && Number.isFinite(Date.parse(point?.at)))
    : [];
  if (likes.length >= 2) {
    const currentPoint = likes.at(-1);
    const previousPoint = [...likes].reverse().find((point) => point.value !== currentPoint.value);
    const delta = previousPoint ? currentPoint.value - previousPoint.value : 0;
    if (delta > 0 && isRecent(currentPoint.at)) {
      badges.push({ kind: 'likes-up', label: `いいね +${delta}`, detail: `いいね数が ${previousPoint.value} から ${currentPoint.value} に増加` });
    }
  }
  return badges;
}

export function compareRecommendedEntries(left, right) {
  const qualification = Number(isDisplayQualified(right)) - Number(isDisplayQualified(left));
  if (qualification !== 0) return qualification;
  const leftScore = Number.isFinite(left?.score) ? left.score : -Infinity;
  const rightScore = Number.isFinite(right?.score) ? right.score : -Infinity;
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftPrice = Number.isFinite(left?.price) ? left.price : Infinity;
  const rightPrice = Number.isFinite(right?.price) ? right.price : Infinity;
  if (leftPrice !== rightPrice) return leftPrice - rightPrice;
  return (Date.parse(right?.checkedAt) || 0) - (Date.parse(left?.checkedAt) || 0);
}

export function isDisplayQualified(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  return entry?.shouldAlert === true
    && entry?.conditionEligible === true
    && !reasons.includes('严重故障/锁机风险')
    && !reasons.includes('不是目标Windows笔记本')
    && !memorySpecConflict(entry).conflict
    && !storageSpecConflict(entry).conflict;
}

export function compactCondition(entry) {
  const level = Number.isInteger(entry?.itemConditionLevel) ? entry.itemConditionLevel : null;
  const labels = {
    1: '新品',
    2: 'ほぼ未使用',
    3: '目立った傷や汚れなし',
  };
  if (level === null) {
    const fallback = entry?.conditionCheckedAt ? '取得不可' : '未チェック';
    return { label: fallback, title: fallback };
  }
  const original = entry?.itemCondition || '状態名不明';
  return {
    label: `${level}｜${labels[level] ?? original}`,
    title: `${level}｜${original}`,
  };
}

export function productFacts(entry) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  const facts = [];
  if (Number.isInteger(entry?.itemConditionLevel)) facts.push(`状態${entry.itemConditionLevel}`);
  if (reasons.includes('32GB内存')) facts.push('32GB');

  const storage = reasons.includes('1TB存储')
    ? '1TB'
    : reasons.includes('512GB存储')
      ? '512GB'
      : '';
  if (storage) facts.push(reasons.includes('未确认SSD') ? storage : `SSD ${storage}`);

  const processor = reasons.find((reason) => /^(?:Intel|Ryzen)\b/i.test(reason));
  if (processor) facts.push(processor.replace(/^(Intel)\s*第(\d+)代$/, '$1 第$2世代'));

  const series = reasons.find((reason) => reason.startsWith('指定系列：'));
  if (series) facts.push(series.slice('指定系列：'.length).trim());

  for (const detail of ['电池描述较好', '电池状态较差', '外观或屏幕有缺陷', '严重故障/锁机风险']) {
    if (reasons.includes(detail)) facts.push(REASON_JA[detail] ?? detail);
  }
  return [...new Set(facts.filter(Boolean))];
}

export function sortDescription(key, direction) {
  const labels = {
    grade: 'ランク',
    price: '価格',
    decision: '判定',
    likes: 'いいね数',
    condition: '商品状態',
    title: '商品名',
    published: '出品日時',
  };
  if (!labels[key]) return 'おすすめ順';
  return `${labels[key]} ${direction === 'asc' ? '昇順' : '降順'}`;
}

export function formatJstShort(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return { short: '時刻不明', full: '時刻不明' };
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return {
    short: `${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
    full: `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`,
  };
}

export function searchText(entry, priceText, blockerText = '') {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons.join(' ') : String(entry?.reasons ?? '');
  return [
    entry?.title,
    reasons,
    entry?.itemCondition,
    entry?.grade,
    priceText,
    blockerText,
  ].filter(Boolean).join(' ');
}

export function primaryBlocker(entry, config = {}) {
  const reasons = Array.isArray(entry?.reasons) ? entry.reasons : [];
  if (reasons.includes('严重故障/锁机风险')) return '深刻な故障・ロックのリスク';
  if (reasons.includes('不是目标Windows笔记本')) return '対象外のWindowsノートPC';
  const memoryConflict = memorySpecConflict(entry);
  if (memoryConflict.conflict) return memoryConflict.label;
  const storageConflict = storageSpecConflict(entry);
  if (storageConflict.conflict) return storageConflict.label;
  if (entry?.shouldAlert === true && entry?.conditionEligible !== false) return '通知条件合致';
  if (!reasons.includes('32GB内存')) return '32GBメモリ未確認';
  if (!reasons.some((reason) => reason === '512GB存储' || reason === '1TB存储')) {
    return '512GB以上のストレージ未確認';
  }
  if (reasons.includes('未确认SSD')) return 'SSD未確認';
  if (!Number.isFinite(entry?.price)) return '価格不明';
  const maxPriceYen = Number(config.maxPriceYen ?? 70000);
  if (entry.price > maxPriceYen) {
    return `予算超過 ¥${(entry.price - maxPriceYen).toLocaleString('ja-JP')}`;
  }
  return 'スコアが通知基準未満';
}

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja-JP').trim();
}

export function matchesResultRow(dataset, filter, query, options = {}) {
  const validFilter = ['all', 'match', 'budget', 'top', 'new', 'changed'].includes(filter) ? filter : 'all';
  const filterMatches = validFilter === 'all'
    || (validFilter === 'match' && dataset.match === '1')
    || (validFilter === 'budget' && dataset.budget === '1')
    || (validFilter === 'top' && Number(dataset.grade) >= 3)
    || (validFilter === 'new' && dataset.new === '1')
    || (validFilter === 'changed' && dataset.changed === '1');
  const selectedSeries = options.series || 'all';
  const seriesMatches = selectedSeries === 'all' || dataset.series === selectedSeries;
  const selectedTriage = options.triage || 'active';
  const rowTriage = dataset.triage || 'unseen';
  const triageMatches = selectedTriage === 'all'
    || (selectedTriage === 'active' && rowTriage !== 'ignored')
    || selectedTriage === rowTriage;
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const haystack = normalizeSearch(dataset.search);
  return filterMatches && seriesMatches && triageMatches
    && tokens.every((token) => haystack.includes(token));
}

export function renderResultsPage(entries, config = {}, { nowMs = Date.now() } = {}) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const maxPriceYen = Number(config.maxPriceYen ?? 70000);
  const requestedPollMinutes = Number(config.pollMinutes ?? 10);
  const pollMinutes = Number.isFinite(requestedPollMinutes) && requestedPollMinutes > 0
    ? requestedPollMinutes
    : 10;
  const recentCutoff = nowMs - 24 * 60 * 60 * 1000;
  const isRecentEntry = (entry) => entry.publishedAt && Date.parse(entry.publishedAt) >= recentCutoff;
  const qualifiedEntries = safeEntries.filter(isDisplayQualified);
  const budgetEntries = safeEntries.filter((entry) => Number.isFinite(entry.price) && entry.price <= maxPriceYen);
  const changedEntries = safeEntries.filter((entry) => recentChangeBadges(entry, nowMs).length > 0);
  const topGradeEntries = safeEntries.filter((entry) => entry.grade === 'S' || entry.grade === 'A');
  const bestEntry = [...qualifiedEntries].sort(compareRecommendedEntries)[0] ?? null;
  const seriesOptions = [...new Map(safeEntries
    .filter((entry) => entry?.seriesId && entry?.seriesLabel)
    .map((entry) => [String(entry.seriesId), String(entry.seriesLabel)])).entries()]
    .sort((left, right) => left[1].localeCompare(right[1], 'ja-JP', { numeric: true }));
  const seriesOptionMarkup = seriesOptions
    .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`)
    .join('');

  const resultRows = safeEntries.map((entry, orderIndex) => {
    const hasPrice = Number.isFinite(entry.price);
    const price = hasPrice ? `¥${Number(entry.price).toLocaleString('ja-JP')}` : '価格不明';
    const likeCount = Number.isInteger(entry.likeCount)
      ? entry.likeCount.toLocaleString('ja-JP')
      : entry.likeCheckedAt ? '取得不可' : '未チェック';
    const likeCheckedMs = Date.parse(entry.likeCheckedAt) || 0;
    const likeFresh = likeCheckedMs > 0
      && nowMs - likeCheckedMs <= Math.max(15, Number(config.likesRefreshMinutes ?? 10) * 2) * 60_000;
    const likeCheckedText = likeCheckedMs
      ? `${formatJstShort(entry.likeCheckedAt).full} JST`
      : '未更新';
    const likeCellTitle = `いいね数 最終更新：${likeCheckedText}（${likeFresh ? 'データ新鮮' : 'バックグラウンド更新待ち'}）`;
    const condition = compactCondition(entry);
    const publishedAt = formatJstShort(entry.publishedAt);
    const firstSeenAt = formatJstShort(entry.firstSeenAt);
    const checkedAt = formatJstShort(entry.checkedAt);
    const reasonsJa = reasonsToJa(entry.reasons).join('、');
    const reasons = Array.isArray(entry.reasons) ? entry.reasons.join('、') : '';
    const facts = productFacts(entry).join(' ｜ ') || reasonsJa;
    const memoryConflict = memorySpecConflict(entry);
    const storageConflict = storageSpecConflict(entry);
    const confidence = specConfidence(entry);
    const shouldAlert = isDisplayQualified(entry);
    const blocker = primaryBlocker(entry, config);
    const decisionClass = shouldAlert
      ? 'decision-match'
      : (memoryConflict.conflict && blocker === memoryConflict.label)
          || (storageConflict.conflict && blocker === storageConflict.label)
        ? 'decision-warning'
        : 'decision-blocked';
    const decision = `<span class="decision ${decisionClass}">${escapeHtml(blocker)}</span>`;
    const isWithinBudget = hasPrice && entry.price <= maxPriceYen;
    const priceDetail = hasPrice
      ? isWithinBudget
        ? '<span class="price-detail is-within">予算内</span>'
        : `<span class="price-detail is-over">+¥${(entry.price - maxPriceYen).toLocaleString('ja-JP')}</span>`
      : '';
    const trend = priceTrend(entry);
    const trendMarkup = trend
      ? `<span class="price-trend ${trend.delta < 0 ? 'trend-down' : 'trend-up'}" title="前回 ¥${trend.previous.toLocaleString('ja-JP')}｜${escapeHtml(`${formatJstShort(trend.changedAt).full} JST`)}">${trend.delta < 0 ? '↓' : '↑'}¥${Math.abs(trend.delta).toLocaleString('ja-JP')}</span>`
      : '';
    const gradeRank = { S: 4, A: 3, B: 2, C: 1 }[entry.grade] ?? 0;
    const decisionRank = shouldAlert ? 2 : memoryConflict.conflict || storageConflict.conflict ? 1 : 0;
    const isRecent = isRecentEntry(entry);
    const changes = recentChangeBadges(entry, nowMs);
    const changeMarkup = changes.map((change) => `<span class="change-badge change-${escapeHtml(change.kind)}" title="${escapeHtml(change.detail)}">${escapeHtml(change.label)}</span>`).join('');
    const itemId = String(entry.id ?? `row-${orderIndex}`);
    const detailsId = `details-${itemId.replace(/[^a-z0-9_-]/gi, '-')}`;
    const latestPriceHistory = trend
      ? `前回 ¥${trend.previous.toLocaleString('ja-JP')} → 現在 ¥${trend.current.toLocaleString('ja-JP')}`
      : '価格変動なし';
    const searchable = searchText(entry, price, blocker);
    return `<tr class="result-row" data-id="${escapeHtml(itemId)}" data-series="${escapeHtml(entry.seriesId ?? '')}" data-changed="${changes.length ? 1 : 0}" data-triage="unseen" data-order="${orderIndex}" data-grade="${gradeRank}" data-price="${hasPrice ? entry.price : ''}" data-decision="${decisionRank}" data-likes="${Number.isInteger(entry.likeCount) ? entry.likeCount : ''}" data-condition="${Number.isInteger(entry.itemConditionLevel) ? entry.itemConditionLevel : ''}" data-title="${escapeHtml(entry.title)}" data-match="${shouldAlert ? 1 : 0}" data-budget="${isWithinBudget ? 1 : 0}" data-new="${isRecent ? 1 : 0}" data-published="${entry.publishedAt ? Date.parse(entry.publishedAt) : ''}" data-search="${escapeHtml(searchable)}">
      <td class="grade-cell"><span class="grade grade-${escapeHtml(entry.grade)}">${escapeHtml(entry.grade)}</span><span class="grade-label">ランク</span></td>
      <td class="numeric-cell price-cell"><span class="price-main">${escapeHtml(price)}</span>${priceDetail}${trendMarkup}</td>
      <td class="decision-cell">${decision}</td>
      <td class="numeric-cell like-cell" title="${escapeHtml(likeCellTitle)}"><span>${escapeHtml(likeCount)}</span><span class="freshness-dot ${likeFresh ? 'is-fresh' : 'is-stale'}" aria-hidden="true"></span></td>
      <td class="condition-cell" title="${escapeHtml(condition.title)}">${escapeHtml(condition.label)}</td>
      <td class="product-cell"><div class="product-title-line">${changeMarkup}<a class="title" title="${escapeHtml(entry.title)}" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.title)}<span class="external-mark" aria-hidden="true">↗</span></a></div><div class="product-meta"><span class="product-facts" title="${escapeHtml(reasons)}">${escapeHtml(facts)}</span><span class="product-actions"><span class="triage-status">未確認</span><button type="button" class="detail-toggle" aria-expanded="false" aria-controls="${escapeHtml(detailsId)}">詳細</button></span></div><div id="${escapeHtml(detailsId)}" class="product-details" hidden><div class="detail-grid"><span><strongスペック信頼度</strong><span class="confidence confidence-${escapeHtml(confidence.level)}">${escapeHtml(confidence.label)}</span> ${escapeHtml(confidence.detail)}</span><span><strong>判定理由</strong>${escapeHtml(reasonsJa || 'なし')}</span><span><strong>元の商品状態</strong>${escapeHtml(entry.itemCondition || '状態不明')}</span><span><strong>日時</strong>初回発見 ${escapeHtml(firstSeenAt.full)} JST ｜ 出品日時 ${escapeHtml(publishedAt.full)} JST ｜ 最終確認 ${escapeHtml(checkedAt.full)} JST</span><span><strong>価格履歴</strong>${escapeHtml(latestPriceHistory)}</span></div><div class="triage-controls" role="group" aria-label="閲覧状態を設定"><span>閲覧状態</span><button type="button" class="triage-button" data-triage-action="unseen" aria-pressed="true">未確認</button><button type="button" class="triage-button" data-triage-action="watch" aria-pressed="false">ウォッチ</button><button type="button" class="triage-button" data-triage-action="ignored" aria-pressed="false">無視略</button></div></div></td>
      <td class="date-cell" title="${escapeHtml(`${publishedAt.full} JST`)}">${escapeHtml(publishedAt.short)}</td>
    </tr>`;
  }).join('\n');

  const rows = resultRows || '<tr class="initial-empty"><td class="empty" colspan="7">还没有检查结果，请先运行监测器或诊断模式。</td></tr>';
  const embeddedNormalizeSearch = normalizeSearch.toString();
  const embeddedMatchesResultRow = matchesResultRow.toString();
  const embeddedSortDescription = sortDescription.toString();

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="600">
  <link rel="icon" href="data:,">
  <title>Mercari 笔记本监测结果</title>
  <style>
    :root { color-scheme: light; font-family: Inter, "Segoe UI", "Microsoft YaHei", "Yu Gothic UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #f7f4ed 0, #f1ede4 48%, #ebe6dc 100%); color: #25282d; }
    main { width: min(1680px, calc(100% - 32px)); margin: 24px auto 40px; }
    .page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 32px; margin: 0 4px 14px; }
    .brand-lockup { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .header-meta { display: flex; align-items: flex-end; flex-direction: column; gap: 8px; }
    .monitor-status { display: inline-flex; align-items: center; gap: 8px; min-height: 30px; padding: 5px 11px; border: 1px solid #d8cdb7; border-radius: 999px; background: rgba(255,254,250,.9); color: #77736b; font-size: 12px; font-weight: 750; white-space: nowrap; }
    .monitor-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #9b958a; box-shadow: 0 0 0 3px rgba(155,149,138,.12); }
    .monitor-status.is-online { border-color: #a8c8b7; color: #2f7254; }
    .monitor-status.is-online .monitor-status-dot { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.14); }
    .monitor-status.is-busy { border-color: #cbb27e; color: #8b631f; }
    .monitor-status.is-busy .monitor-status-dot { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.14); }
    .monitor-status.is-offline { border-color: #d8b2aa; color: #9a5145; }
    .monitor-status.is-offline .monitor-status-dot { background: #b76b5d; box-shadow: 0 0 0 3px rgba(183,107,93,.12); }
    .brand-mark { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border: 1px solid #a77a2d; border-radius: 12px; background: linear-gradient(145deg, #d8b86e, #9b6e25 72%); color: #fffaf0; font: 900 23px/1 Georgia, serif; box-shadow: 0 7px 20px rgba(133,95,31,.16), inset 0 1px rgba(255,255,255,.4); }
    .eyebrow { margin: 0 0 4px; color: #9a732f; font-size: 12px; font-weight: 800; letter-spacing: .16em; }
    h1 { margin: 0; color: #25282d; font-size: clamp(22px, 2vw, 30px); font-weight: 760; letter-spacing: .015em; white-space: nowrap; }
    .hint { margin: 0 0 4px; color: #77736b; font-size: 12px; text-align: right; white-space: nowrap; }
    .summary-strip { display: grid; grid-template-columns: repeat(5, minmax(130px, 1fr)); margin-bottom: 10px; overflow: hidden; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,254,250,.9); }
    .filter-button { min-height: 54px; padding: 9px 14px; border: 0; border-right: 1px solid #e5ddcf; background: transparent; color: #736e65; font: inherit; text-align: left; cursor: pointer; }
    .filter-button:last-child { border-right: 0; }
    .filter-button:hover { background: #f5f0e7; color: #3c3d40; }
    .filter-button.active { background: #f3e8d2; color: #7d5a1e; box-shadow: inset 0 -3px #b58a3d; }
    .metric-label { display: block; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .metric-value { display: block; margin-top: 3px; color: #292c31; font: 760 18px/1 "Cascadia Mono", Consolas, monospace; font-variant-numeric: tabular-nums; }
    .filter-button.active .metric-value { color: #8a631f; }
    .best-candidate { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 14px; min-height: 48px; margin-bottom: 10px; padding: 9px 14px; border-left: 3px solid #b58a3d; background: rgba(255,253,248,.82); }
    .best-label { color: #8f6723; font-size: 12px; font-weight: 800; letter-spacing: .06em; white-space: nowrap; }
    .best-facts { display: inline-flex; align-items: center; gap: 7px; color: #35373b; font-size: 12px; white-space: nowrap; }
    .best-grade { color: #2f7254; font-weight: 800; }
    .best-budget { padding: 2px 6px; border-radius: 4px; background: #e8f4ed; color: #2f7254; font-weight: 750; }
    .best-title { min-width: 0; overflow: hidden; color: #72511b; font-size: 13px; font-weight: 720; text-overflow: ellipsis; text-decoration: none; white-space: nowrap; }
    .best-title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .best-empty { color: #817b70; font-size: 12px; }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; margin-bottom: 10px; padding: 7px 10px; border: 1px solid #ddd3c1; border-radius: 10px; background: rgba(255,253,248,.88); }
    .search-group { display: flex; flex: 1 1 auto; align-items: center; gap: 8px; min-width: 0; }
    .search-input { width: clamp(260px, 32vw, 520px); min-height: 34px; padding: 7px 10px; border: 1px solid #d5c9b4; border-radius: 8px; background: #fffefa; color: #303238; font: inherit; font-size: 12px; outline: none; }
    .search-input::placeholder { color: #9a9489; }
    .search-input:focus { border-color: #a77a2d; box-shadow: 0 0 0 3px rgba(167,122,45,.12); }
    .control-select { min-height: 34px; max-width: 180px; padding: 6px 28px 6px 9px; border: 1px solid #d5c9b4; border-radius: 8px; background: #fffefa; color: #4f4d48; font: inherit; font-size: 12px; outline: none; cursor: pointer; }
    .control-select:focus { border-color: #a77a2d; box-shadow: 0 0 0 3px rgba(167,122,45,.12); }
    .toolbar-state { display: flex; align-items: center; justify-content: flex-end; gap: 9px; min-width: 0; }
    .toolbar-note { color: #817b70; font-size: 12px; white-space: nowrap; }
    .result-count { min-width: 82px; color: #817b70; font: 700 12px/1.2 "Cascadia Mono", Consolas, monospace; white-space: nowrap; }
    .sort-summary { color: #6f6a61; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .recommendation-help { display: inline-grid; width: 25px; height: 25px; flex: 0 0 25px; padding: 0; place-items: center; border: 1px solid #d5c9b4; border-radius: 50%; background: #fffefa; color: #806128; font-family: inherit; font-size: 12px; font-weight: 800; line-height: 1; cursor: help; }
    .recommendation-help:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .reset-sort { min-height: 30px; padding: 5px 9px; border: 1px solid #d5c9b4; border-radius: 7px; background: #fffefa; color: #76591f; font: inherit; font-size: 12px; font-weight: 750; white-space: nowrap; cursor: pointer; }
    .reset-sort:hover { border-color: #b58a3d; background: #f7eedb; }
    .reset-sort:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .reset-sort[hidden] { display: none; }
    .panel { overflow: auto; background: #fffefa; border: 1px solid #d8cdb7; border-radius: 12px; box-shadow: 0 10px 30px rgba(72,58,34,.07); scrollbar-color: #b4965d #eee8dc; }
    table { width: 100%; min-width: 1180px; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
    th:nth-child(1) { width: 76px; }
    th:nth-child(2) { width: 80px; }
    th:nth-child(3) { width: 145px; }
    th:nth-child(4) { width: 142px; }
    th:nth-child(5) { width: 112px; }
    th:nth-child(7) { width: 108px; }
    th, td { padding: 12px 13px; border-bottom: 1px solid #ebe5da; text-align: left; vertical-align: middle; white-space: nowrap; }
    th { position: sticky; top: 0; z-index: 2; background: #ece6da; color: #735824; font-size: 12px; font-weight: 750; letter-spacing: .025em; box-shadow: inset 0 -1px #d2c6af; }
    tbody tr { transition: background-color .16s ease; }
    tbody tr:hover { background: #fbf4e7; }
    .sort-button { display: inline-flex; align-items: center; gap: 6px; padding: 5px 7px; margin: -5px -7px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; font-weight: inherit; white-space: nowrap; cursor: pointer; }
    .sort-button:hover { background: rgba(167,122,45,.09); color: #8f6723; }
    .sort-button:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .sort-icon { min-width: 12px; color: #aa9a79; font-size: 14px; line-height: 1; }
    th[aria-sort="ascending"] .sort-icon, th[aria-sort="descending"] .sort-icon { color: #9b6f24; }
    th[aria-sort="ascending"] .sort-button, th[aria-sort="descending"] .sort-button { background: #f5e8ce; color: #7b581d; }
    td { color: #34373c; font-size: 13px; }
    tr:last-child td { border-bottom: 0; }
    th:first-child, td:first-child { padding-left: 18px; }
    th:last-child, td:last-child { padding-right: 18px; }
    th:first-child { left: 0; z-index: 4; }
    td:first-child { position: sticky; left: 0; z-index: 1; background: #fffefa; box-shadow: 1px 0 #e2dacb; }
    tbody tr:hover td:first-child { background: #fbf4e7; }
    .grade-cell, .numeric-cell, .decision-cell, .condition-cell, .date-cell { width: 1%; white-space: nowrap; }
    .decision-cell { min-width: 145px; }
    .price-cell { font-variant-numeric: tabular-nums; }
    .price-main, .price-detail { display: block; }
    .price-detail { margin-top: 3px; font-size: 12px; font-weight: 700; }
    .price-detail.is-within { color: #2f7254; }
    .price-detail.is-over { color: #985a45; }
    .price-trend { display: block; margin-top: 3px; font-size: 12px; font-weight: 800; }
    .trend-down { color: #2f7254; }
    .trend-up { color: #985a45; }
    .like-cell { font-variant-numeric: tabular-nums; }
    .freshness-dot { display: inline-block; width: 7px; height: 7px; margin-left: 7px; border-radius: 50%; vertical-align: 1px; }
    .freshness-dot.is-fresh { background: #3f8766; box-shadow: 0 0 0 3px rgba(63,135,102,.12); }
    .freshness-dot.is-stale { background: #b58a3d; box-shadow: 0 0 0 3px rgba(181,138,61,.12); }
    .product-cell { width: 100%; min-width: 440px; }
    .product-title-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .title { display: -webkit-box; min-width: 0; overflow: hidden; color: #7f5b1d; font-weight: 720; line-height: 1.38; text-decoration: none; letter-spacing: .005em; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .title:hover { color: #a77a2d; text-decoration: underline; text-underline-offset: 3px; }
    .external-mark { margin-left: 5px; color: #a77a2d; font-size: 12px; }
    .change-badge { flex: 0 0 auto; padding: 2px 5px; border: 1px solid #cbbfaa; border-radius: 4px; background: #f7f2e8; color: #745b2f; font-size: 12px; font-weight: 800; line-height: 1.2; white-space: nowrap; }
    .change-new { border-color: #c2a66f; background: #f7eedb; color: #8f6723; }
    .change-price-down { border-color: #8ebca5; background: #e8f4ed; color: #2f7254; }
    .change-likes-up { border-color: #a8b9c7; background: #edf3f7; color: #496b82; }
    .product-meta { display: flex; align-items: center; gap: 9px; min-width: 0; margin-top: 5px; }
    .product-facts { display: block; min-width: 0; flex: 1 1 auto; overflow: hidden; color: #817b72; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
    .product-actions { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 6px; }
    .triage-status { color: #8f6723; font-size: 12px; font-weight: 800; }
    .result-row.is-seen .triage-status { color: #817b72; }
    .result-row.is-watch .triage-status { color: #2f7254; }
    .result-row.is-ignored { opacity: .72; }
    .detail-toggle { padding: 2px 6px; border: 0; border-radius: 4px; background: transparent; color: #76591f; font: inherit; font-size: 12px; font-weight: 750; cursor: pointer; }
    .detail-toggle:hover { background: #f3e8d2; }
    .detail-toggle:focus-visible, .triage-button:focus-visible { outline: 2px solid #a77a2d; outline-offset: 2px; }
    .product-details { margin-top: 9px; padding: 10px 11px; border-left: 2px solid #c7a25c; background: #faf6ed; color: #5f5b54; font-size: 12px; line-height: 1.55; white-space: normal; }
    .detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 16px; }
    .detail-grid strong { margin-right: 7px; color: #5c4926; }
    .confidence { display: inline-block; margin-right: 5px; padding: 1px 5px; border-radius: 4px; font-weight: 800; }
    .confidence-title, .confidence-detail { background: #e8f4ed; color: #2f7254; }
    .confidence-conflict { background: #fff0e7; color: #985a45; }
    .confidence-unknown { background: #eeeae2; color: #716d65; }
    .triage-controls { display: flex; align-items: center; gap: 6px; margin-top: 9px; padding-top: 8px; border-top: 1px solid #e4dccd; }
    .triage-controls > span { margin-right: 2px; color: #5c4926; font-weight: 800; }
    .triage-button { padding: 3px 8px; border: 1px solid #d5c9b4; border-radius: 5px; background: #fffefa; color: #6d675e; font: inherit; font-size: 12px; cursor: pointer; }
    .triage-button[aria-pressed="true"] { border-color: #b58a3d; background: #f3e8d2; color: #76591f; font-weight: 800; }
    .decision { display: inline-block; max-width: 210px; padding: 3px 7px; border: 1px solid; border-radius: 5px; font-size: 12px; font-weight: 800; line-height: 1.35; white-space: normal; }
    .decision-match { border-color: #8ebca5; background: #e8f4ed; color: #2f7254; }
    .decision-blocked { border-color: #d5b8a8; background: #f8eee8; color: #985a45; }
    .decision-warning { border-color: #d6bd7c; background: #fff5d9; color: #815d18; }
    .grade { display: inline-grid; width: 27px; height: 27px; place-items: center; border: 1px solid rgba(70,60,40,.12); border-radius: 8px; font-weight: 850; box-shadow: inset 0 1px rgba(255,255,255,.3); }
    .grade-label { margin-left: 5px; color: #817b72; font-size: 12px; }
    .grade-S { background: linear-gradient(145deg, #c89d47, #8c611f); color: #fffaf0; } .grade-A { background: #3f8766; color: #fff; } .grade-B { background: #d39b31; color: #33250d; } .grade-C { background: #8b8b86; color: #fff; }
    .empty { padding: 48px; color: #817b72; text-align: center; }
    @media (max-width: 1120px) { .page-header { align-items: flex-start; flex-direction: column; gap: 10px; } .header-meta { align-items: flex-start; } .hint { text-align: left; } .best-candidate { grid-template-columns: auto 1fr; } .best-title { grid-column: 1 / -1; } .toolbar { flex-wrap: wrap; } .search-group { flex: 1 1 100%; } .toolbar-state { margin-left: auto; } }
    @media (max-width: 920px) { .summary-strip { grid-template-columns: repeat(3, minmax(130px, 1fr)); } .filter-button:nth-child(3) { border-right: 0; } .filter-button:nth-child(-n+3) { border-bottom: 1px solid #e5ddcf; } table { min-width: 820px; } th:nth-child(7), td:nth-child(7) { display: none; } }
    @media (max-width: 700px) { main { width: min(100% - 20px, 1680px); margin-top: 16px; } h1 { white-space: normal; } .summary-strip { grid-template-columns: repeat(2, minmax(120px, 1fr)); } .filter-button { border-right: 1px solid #e5ddcf; border-bottom: 1px solid #e5ddcf; } .filter-button:nth-child(even) { border-right: 0; } .filter-button:last-child { grid-column: 1 / -1; border-right: 0; border-bottom: 0; } .best-candidate { grid-template-columns: 1fr; gap: 6px; } .best-title { grid-column: auto; white-space: normal; } .toolbar { align-items: stretch; flex-direction: column; } .search-group { width: 100%; flex-wrap: wrap; } .search-input { flex: 1 1 240px; width: auto; } .control-select { flex: 1 1 150px; max-width: none; } .toolbar-state { align-self: flex-end; } .detail-grid { grid-template-columns: 1fr; } table { min-width: 690px; } .decision-cell { min-width: 132px; } .product-cell { min-width: 300px; } th:nth-child(4), td:nth-child(4), th:nth-child(5), td:nth-child(5) { display: none; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition: none !important; } }
  </style>
</head>
<body><main>
  <header class="page-header">
    <div class="brand-lockup"><span class="brand-mark">M</span><div><p class="eyebrow">MERCARI LAPTOP MONITOR</p><h1>Mercari 笔记本监测结果</h1></div></div>
    <div class="header-meta">
      <div id="monitor-status" class="monitor-status" title="未运行时请双击 open-results.cmd"><span class="monitor-status-dot" aria-hidden="true"></span><span id="monitor-status-text">正在检测后台状态…</span></div>
      <p class="hint">搜索或点击栏目排序 · 页面每10分钟刷新 · 后台每${escapeHtml(pollMinutes)}分钟检查</p>
    </div>
  </header>
  <section class="summary-strip" role="group" aria-label="结果概览与快捷筛选">
    <button type="button" class="filter-button active" data-filter="all"><span class="metric-label">当前记录</span><strong class="metric-value">${safeEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="match"><span class="metric-label">符合提醒</span><strong class="metric-value">${qualifiedEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="budget"><span class="metric-label">预算内 ≤ ¥${maxPriceYen.toLocaleString('ja-JP')}</span><strong class="metric-value">${budgetEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="changed"><span class="metric-label">24H 有变化</span><strong class="metric-value">${changedEntries.length}</strong></button>
    <button type="button" class="filter-button" data-filter="top"><span class="metric-label">S / A 级</span><strong class="metric-value">${topGradeEntries.length}</strong></button>
  </section>
  <section class="best-candidate" aria-label="当前最佳候选">
    <strong class="best-label">当前最佳候选</strong>
    ${bestEntry ? `<span class="best-facts"><span class="best-grade">${escapeHtml(bestEntry.grade)}级</span><strong>¥${Number(bestEntry.price).toLocaleString('ja-JP')}</strong><span class="best-budget">预算内</span></span><a class="best-title" title="${escapeHtml(bestEntry.title)}" href="${escapeHtml(bestEntry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(bestEntry.title)}<span class="external-mark" aria-hidden="true">↗</span></a>` : '<span class="best-empty">暂无符合条件且规格一致的商品</span>'}
  </section>
  <section class="toolbar" aria-label="商品搜索">
    <div class="search-group">
      <input id="product-search" class="search-input" type="search" aria-label="搜索商品" placeholder="搜索品牌、型号、CPU、判断…" autocomplete="off">
      <select id="series-filter" class="control-select" aria-label="筛选系列"><option value="all">全部系列</option>${seriesOptionMarkup}</select>
      <select id="triage-filter" class="control-select" aria-label="筛选浏览状态"><option value="active">活跃商品</option><option value="unseen">未看</option><option value="watch">关注</option><option value="seen">已看</option><option value="ignored">忽略</option><option value="all">全部（含忽略）</option></select>
      <output id="result-count" class="result-count" for="product-search" aria-live="polite">显示 ${safeEntries.length} / ${safeEntries.length}</output>
    </div>
    <div class="toolbar-state">
      <output id="sort-summary" class="sort-summary" aria-live="polite">当前排序：推荐顺序</output>
      <button type="button" class="recommendation-help" title="推荐顺序：符合提醒优先，其次按评分、价格和检查时间排序" aria-label="查看推荐顺序说明">?</button>
      <button id="reset-sort" class="reset-sort" type="button" hidden>恢复推荐顺序</button>
    </div>
  </section>
  <div class="panel"><table>
    <thead><tr>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="grade" data-default-direction="desc">等级 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="price" data-default-direction="asc">价格 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="decision" data-default-direction="desc">判断 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="likes" data-default-direction="desc">收藏数（いいね） <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="condition" data-default-direction="asc">商品状态 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="title" data-default-direction="asc">商品 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
      <th aria-sort="none"><button type="button" class="sort-button" data-sort="published" data-default-direction="desc">发布时间 <span class="sort-icon" aria-hidden="true">⇅</span></button></th>
    </tr></thead>
    <tbody>${rows}<tr id="no-results-row" hidden><td class="empty" colspan="7">没有符合当前筛选和搜索的商品。</td></tr></tbody>
  </table></div>
</main>
<script>
  (() => {
    const tbody = document.querySelector('tbody');
    const sortButtons = [...document.querySelectorAll('.sort-button')];
    const filterButtons = [...document.querySelectorAll('.filter-button')];
    const searchInput = document.querySelector('#product-search');
    const seriesFilter = document.querySelector('#series-filter');
    const triageFilter = document.querySelector('#triage-filter');
    const resultCount = document.querySelector('#result-count');
    const sortSummary = document.querySelector('#sort-summary');
    const resetSortButton = document.querySelector('#reset-sort');
    const noResultsRow = document.querySelector('#no-results-row');
    const monitorStatus = document.querySelector('#monitor-status');
    const monitorStatusText = document.querySelector('#monitor-status-text');
    const storageKey = 'mercari-laptop-monitor-sort';
    const filterStorageKey = 'mercari-laptop-monitor-filter';
    const searchStorageKey = 'mercari-laptop-monitor-search';
    const seriesStorageKey = 'mercari-laptop-monitor-series';
    const triageFilterStorageKey = 'mercari-laptop-monitor-triage-filter';
    const triageStorageKey = 'mercari-laptop-monitor-triage-v1';
    const pollMinutes = ${JSON.stringify(pollMinutes)};
    let currentSort = null;
    let currentFilter = 'all';
    let currentSearch = '';
    let currentSeries = 'all';
    let currentTriageFilter = 'active';
    let triageState = {};
    try { currentSort = JSON.parse(localStorage.getItem(storageKey)); } catch {}
    try { currentFilter = localStorage.getItem(filterStorageKey) || 'all'; } catch {}
    try { currentSearch = localStorage.getItem(searchStorageKey) || ''; } catch {}
    try { currentSeries = localStorage.getItem(seriesStorageKey) || 'all'; } catch {}
    try { currentTriageFilter = localStorage.getItem(triageFilterStorageKey) || 'active'; } catch {}
    try {
      const parsedTriage = JSON.parse(localStorage.getItem(triageStorageKey));
      triageState = parsedTriage && typeof parsedTriage === 'object' && !Array.isArray(parsedTriage)
        ? parsedTriage
        : {};
    } catch {}
    searchInput.value = currentSearch;

    ${embeddedNormalizeSearch}
    ${embeddedMatchesResultRow}
    ${embeddedSortDescription}

    function renderMonitorStatus(status) {
      const heartbeatMs = Date.parse(status?.heartbeatAt) || 0;
      const ageMs = heartbeatMs ? Date.now() - heartbeatMs : Infinity;
      const heartbeatText = heartbeatMs
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(heartbeatMs)
        : '';
      const nextCheckText = heartbeatMs
        ? new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Tokyo',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(heartbeatMs + pollMinutes * 60_000)
        : '';
      monitorStatus.classList.remove('is-online', 'is-busy', 'is-offline');
      monitorStatus.title = [status?.phase, status?.message].filter(Boolean).join('｜')
        || '未运行时请双击 open-results.cmd';
      if (!status || status.running !== true || ageMs > 900_000) {
        monitorStatus.classList.add('is-offline');
        monitorStatusText.textContent = heartbeatText
          ? '后台未运行｜最后记录 ' + heartbeatText
          : '后台未启动｜请运行 open-results.cmd';
        return;
      }
      const busy = String(status.phase || '').startsWith('正在');
      monitorStatus.classList.add(busy ? 'is-busy' : 'is-online');
      monitorStatusText.textContent = busy
        ? (status.phase || '正在检查') + '｜状态更新 ' + heartbeatText
        : '后台正常｜上次检查 ' + heartbeatText + '｜下次约 ' + nextCheckText;
    }

    function refreshMonitorStatus() {
      window.__MERCARI_MONITOR_STATUS__ = undefined;
      const script = document.createElement('script');
      script.src = 'monitor-status.js?t=' + Date.now();
      script.onload = () => {
        renderMonitorStatus(window.__MERCARI_MONITOR_STATUS__);
        script.remove();
      };
      script.onerror = () => {
        renderMonitorStatus(null);
        script.remove();
      };
      document.head.append(script);
    }

    function valueFor(row, key) {
      if (key === 'title') return row.dataset.title || '';
      if ((key === 'price' || key === 'likes' || key === 'condition' || key === 'published') && row.dataset[key] === '') return null;
      return Number(row.dataset[key]);
    }

    function applySort(key, direction, remember = true) {
      const resultRows = [...tbody.querySelectorAll('.result-row')];
      resultRows.sort((left, right) => {
        const a = valueFor(left, key);
        const b = valueFor(right, key);
        if (a === null && b !== null) return 1;
        if (a !== null && b === null) return -1;
        const comparison = typeof a === 'string'
          ? a.localeCompare(b, 'ja-JP', { numeric: true, sensitivity: 'base' })
          : a - b;
        return comparison === 0
          ? Number(left.dataset.order) - Number(right.dataset.order)
          : direction === 'asc' ? comparison : -comparison;
      });
      resultRows.forEach((row) => tbody.insertBefore(row, noResultsRow));
      sortButtons.forEach((button) => {
        const active = button.dataset.sort === key;
        button.querySelector('.sort-icon').textContent = active ? (direction === 'asc' ? '↑' : '↓') : '⇅';
        button.closest('th').setAttribute('aria-sort', active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none');
      });
      currentSort = { key, direction };
      sortSummary.textContent = '当前排序：' + sortDescription(key, direction);
      resetSortButton.hidden = false;
      if (remember) {
        try { localStorage.setItem(storageKey, JSON.stringify(currentSort)); } catch {}
      }
    }

    function resetRecommendedOrder(remember = true) {
      const resultRows = [...tbody.querySelectorAll('.result-row')]
        .sort((left, right) => Number(left.dataset.order) - Number(right.dataset.order));
      resultRows.forEach((row) => tbody.insertBefore(row, noResultsRow));
      sortButtons.forEach((button) => {
        button.querySelector('.sort-icon').textContent = '⇅';
        button.closest('th').setAttribute('aria-sort', 'none');
      });
      currentSort = null;
      sortSummary.textContent = '当前排序：' + sortDescription();
      resetSortButton.hidden = true;
      if (remember) {
        try { localStorage.removeItem(storageKey); } catch {}
      }
    }

    function normalizeTriage(value) {
      return ['unseen', 'seen', 'watch', 'ignored'].includes(value) ? value : 'unseen';
    }

    function applyRowTriage(row, value) {
      const triage = normalizeTriage(value);
      const labels = { unseen: '未看', seen: '已看', watch: '关注', ignored: '忽略' };
      row.dataset.triage = triage;
      row.classList.toggle('is-seen', triage === 'seen');
      row.classList.toggle('is-watch', triage === 'watch');
      row.classList.toggle('is-ignored', triage === 'ignored');
      const status = row.querySelector('.triage-status');
      if (status) status.textContent = labels[triage];
      row.querySelectorAll('.triage-button').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.triageAction === triage));
      });
    }

    function persistTriage() {
      const entries = Object.entries(triageState)
        .filter(([, value]) => ['seen', 'watch', 'ignored'].includes(value))
        .slice(-1000);
      triageState = Object.fromEntries(entries);
      try { localStorage.setItem(triageStorageKey, JSON.stringify(triageState)); } catch {}
    }

    function setTriage(row, value) {
      const triage = normalizeTriage(value);
      const id = row.dataset.id;
      if (triage === 'unseen') delete triageState[id];
      else triageState[id] = triage;
      applyRowTriage(row, triage);
      persistTriage();
      applyVisibility();
    }

    function applyVisibility({ rememberFilter = false, rememberSearch = false } = {}) {
      const resultRows = [...tbody.querySelectorAll('.result-row')];
      let visibleCount = 0;
      resultRows.forEach((row) => {
        const visible = matchesResultRow(row.dataset, currentFilter, currentSearch, {
          series: currentSeries,
          triage: currentTriageFilter,
        });
        row.hidden = !visible;
        if (visible) visibleCount += 1;
      });
      filterButtons.forEach((button) => button.classList.toggle('active', button.dataset.filter === currentFilter));
      resultCount.textContent = '显示 ' + visibleCount + ' / ' + resultRows.length;
      noResultsRow.hidden = resultRows.length === 0 || visibleCount !== 0;
      if (rememberFilter) {
        try { localStorage.setItem(filterStorageKey, currentFilter); } catch {}
      }
      if (rememberSearch) {
        try { localStorage.setItem(searchStorageKey, currentSearch); } catch {}
      }
    }

    sortButtons.forEach((button) => button.addEventListener('click', () => {
      const key = button.dataset.sort;
      const direction = currentSort?.key === key
        ? (currentSort.direction === 'asc' ? 'desc' : 'asc')
        : button.dataset.defaultDirection;
      applySort(key, direction);
    }));
    resetSortButton.addEventListener('click', () => resetRecommendedOrder());

    filterButtons.forEach((button) => button.addEventListener('click', () => {
      currentFilter = ['all', 'match', 'budget', 'top', 'changed'].includes(button.dataset.filter) ? button.dataset.filter : 'all';
      applyVisibility({ rememberFilter: true });
    }));

    seriesFilter.addEventListener('change', () => {
      currentSeries = [...seriesFilter.options].some((option) => option.value === seriesFilter.value)
        ? seriesFilter.value
        : 'all';
      try { localStorage.setItem(seriesStorageKey, currentSeries); } catch {}
      applyVisibility();
    });

    triageFilter.addEventListener('change', () => {
      currentTriageFilter = ['active', 'unseen', 'seen', 'watch', 'ignored', 'all'].includes(triageFilter.value)
        ? triageFilter.value
        : 'active';
      try { localStorage.setItem(triageFilterStorageKey, currentTriageFilter); } catch {}
      applyVisibility();
    });

    tbody.querySelectorAll('.detail-toggle').forEach((button) => button.addEventListener('click', () => {
      const panel = document.getElementById(button.getAttribute('aria-controls'));
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? '详情' : '收起';
      panel.hidden = expanded;
    }));

    tbody.querySelectorAll('.triage-button').forEach((button) => button.addEventListener('click', () => {
      setTriage(button.closest('.result-row'), button.dataset.triageAction);
    }));

    tbody.querySelectorAll('.title').forEach((link) => link.addEventListener('click', () => {
      const row = link.closest('.result-row');
      if (row.dataset.triage === 'unseen') setTriage(row, 'seen');
    }));

    searchInput.addEventListener('input', () => {
      currentSearch = searchInput.value;
      applyVisibility({ rememberSearch: true });
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && searchInput.value) {
        searchInput.value = '';
        currentSearch = '';
        applyVisibility({ rememberSearch: true });
      }
    });

    [...tbody.querySelectorAll('.result-row')].forEach((row) => {
      applyRowTriage(row, triageState[row.dataset.id]);
    });
    currentFilter = currentFilter === 'new' ? 'changed' : currentFilter;
    if (currentSort && sortButtons.some((button) => button.dataset.sort === currentSort.key)) {
      applySort(currentSort.key, currentSort.direction === 'asc' ? 'asc' : 'desc', false);
    } else {
      resetRecommendedOrder(Boolean(currentSort));
    }
    currentFilter = ['all', 'match', 'budget', 'top', 'changed'].includes(currentFilter) ? currentFilter : 'all';
    currentSeries = [...seriesFilter.options].some((option) => option.value === currentSeries) ? currentSeries : 'all';
    currentTriageFilter = ['active', 'unseen', 'seen', 'watch', 'ignored', 'all'].includes(currentTriageFilter)
      ? currentTriageFilter
      : 'active';
    seriesFilter.value = currentSeries;
    triageFilter.value = currentTriageFilter;
    applyVisibility();
    refreshMonitorStatus();
  })();
</script>
</body></html>\n`;
}
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
