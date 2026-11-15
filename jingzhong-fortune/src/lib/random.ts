/** 以瀏覽器安全亂數產生 0～(max-1) 的均勻整數（拒絕取樣，無模數偏差）。 */
export function secureRandomInt(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}
