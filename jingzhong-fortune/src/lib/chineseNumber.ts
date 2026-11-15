const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1～99 轉為中文數字，例如 12 → 十二、58 → 五十八。 */
export function toChineseNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${DIGITS[ones]}`;
}
