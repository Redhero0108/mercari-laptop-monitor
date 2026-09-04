import { createRequire } from 'node:module';
import { detectListingAvailability } from './availability.mjs';
import { parseLikeCount } from './likes.mjs';
import { parsePrice } from './scoring.mjs';
import { extractPublishedAtFromPhotoUrls } from './time.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SEARCH_BASE = 'https://jp.mercari.com/search';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';

export function searchUrl(query, { maxConditionLevel = 3, excludeKeywords = [] } = {}) {
  const url = new URL(SEARCH_BASE);
  url.searchParams.set('keyword', query);
  url.searchParams.set('status', 'on_sale');
  url.searchParams.set('sort', 'created_time');
  url.searchParams.set('order', 'desc');
  url.searchParams.set(
    'item_condition_id',
    Array.from({ length: maxConditionLevel }, (_, index) => index + 1).join(','),
  );
  if (excludeKeywords.length) {
    url.searchParams.set('exclude_keyword', excludeKeywords.join(' '));
  }
  return url.href;
}

export async function launchBrowser({ showBrowser = false, headless = true, log = () => {} } = {}) {
  const resolvedHeadless = showBrowser ? false : Boolean(headless);
  const common = { headless: resolvedHeadless, locale: 'ja-JP', userAgent: USER_AGENT };
  const attempts = [
    ['Brave', { ...common, executablePath: 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe' }],
    ['Google Chrome', { ...common, channel: 'chrome' }],
    ['Microsoft Edge', { ...common, channel: 'msedge' }],
    ['Playwright Chromium', common],
  ];
  const errors = [];
  for (const [name, options] of attempts) {
    try {
      const instance = await chromium.launch(options);
      await log(`浏览器已启动：${name}${resolvedHeadless ? '（后台）' : '（可见）'}`);
      return instance;
    } catch (error) {
      errors.push(`${name}: ${error.message.split(/\r?\n/, 1)[0]}`);
    }
  }
  throw new Error(`无法启动浏览器：${errors.join('；')}`);
}

export async function readSearch(page, query, { limit = 60 } = {}) {
  await page.goto(searchUrl(query), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForTimeout(2200);
  const cards = await page.evaluate((maxCards) => Array.from(document.querySelectorAll('a[href*="/item/"]'))
    .slice(0, maxCards)
    .map((anchor) => ({
      href: anchor.href,
      text: (anchor.innerText || anchor.getAttribute('aria-label') || anchor.querySelector('img')?.alt || '').trim(),
      alt: (anchor.querySelector('img')?.alt || '').trim(),
    }))
    .filter((item) => /\/item\/m\d+/.test(item.href) && item.text), limit);

  const unique = new Map();
  for (const card of cards) {
    const id = card.href.match(/\/item\/(m\d+)/)?.[1];
    if (!id || unique.has(id)) continue;
    const lines = card.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const rawTitle = card.alt || lines
      .filter((line) => !/^(?:¥|￥|\d+%OFF|現在|[\d,]+円?)$/.test(line))
      .join(' ')
      .trim() || card.text;
    const title = rawTitle.replace(/のサムネイル$/, '').trim();
    unique.set(id, {
      id,
      title,
      price: parsePrice(card.text),
      url: `https://jp.mercari.com/item/${id}`,
      query,
    });
  }
  return [...unique.values()];
}

export async function readDetail(page, item) {
  const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let pageData = { mainText: '', photoUrls: [], likeText: null, itemCondition: null, soldButtonText: null };
  for (const delay of [1400, 2200, 3200]) {
    await page.waitForTimeout(delay);
    pageData = await page.evaluate(() => {
      const conditionElement = document.querySelector('[data-testid="商品の状態"]');
      const itemCondition = conditionElement
        ? [...conditionElement.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent)
          .join(' ')
          .trim()
        : null;
      return {
        mainText: document.querySelector('main')?.innerText || '',
        photoUrls: [
        document.querySelector('meta[property="og:image"]')?.content,
        ...[...document.images].flatMap((image) => [
          image.getAttribute('src'),
          image.currentSrc,
          ...(image.getAttribute('srcset') || '').split(',').map((part) => part.trim().split(/\s+/, 1)[0]),
        ]),
        ].filter(Boolean),
        likeText: document.querySelector('[data-testid="icon-heart-button"]')?.innerText?.trim() ?? null,
        itemCondition,
        soldButtonText: [...document.querySelectorAll('button')]
          .find((button) => button.disabled && button.textContent?.trim() === '売り切れました')
          ?.textContent?.trim() ?? null,
      };
    });
    if (pageData.mainText.trim() && (pageData.likeText !== null || pageData.soldButtonText !== null)) break;
  }
  if (!pageData.mainText.trim()) throw new Error(`商品详情为空（页面：${page.url()}）`);
  const availability = detectListingAvailability(
    pageData.mainText,
    response?.status() ?? null,
    pageData.soldButtonText,
  );
  const ownListing = pageData.mainText.split('商品の情報')[0].slice(0, 12000);
  return {
    ...item,
    detail: ownListing,
    price: parsePrice(ownListing) ?? item.price,
    likeCount: parseLikeCount(pageData.likeText),
    itemCondition: pageData.itemCondition ?? item.itemCondition ?? null,
    publishedAt: extractPublishedAtFromPhotoUrls(pageData.photoUrls, item.id),
    sold: availability.sold,
    removed: availability.removed,
    unavailableReason: availability.reason,
  };
}
