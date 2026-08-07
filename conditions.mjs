export const ITEM_CONDITIONS = [
  '新品、未使用',
  '未使用に近い',
  '目立った傷や汚れなし',
  'やや傷や汚れあり',
  '傷や汚れあり',
  '全体的に状態が悪い',
];

function normalizeCondition(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s、,，]+/g, '')
    .trim();
}

const CONDITION_LEVELS = new Map(
  ITEM_CONDITIONS.map((condition, index) => [normalizeCondition(condition), index + 1]),
);

export function conditionLevel(value) {
  return CONDITION_LEVELS.get(normalizeCondition(value)) ?? null;
}

export function isConditionAllowed(value, maxLevel = 3) {
  const level = conditionLevel(value);
  return level !== null && level <= Number(maxLevel);
}
