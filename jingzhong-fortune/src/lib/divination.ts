import { secureRandomInt } from './random';

/** 筊杯朝上的一面：flat 平面、round 凸面。 */
export type CupFace = 'flat' | 'round';
export type DivinationResult = 'sheng' | 'xiao' | 'yin';

export const DIVINATION_INFO: Record<DivinationResult, { label: string; description: string }> = {
  sheng: { label: '聖筊', description: '一平面、一凸面' },
  xiao: { label: '笑筊', description: '兩個平面朝上' },
  yin: { label: '陰筊', description: '兩個凸面朝上' },
};

/** 模擬擲筊：兩個筊杯各自獨立隨機落地。與抽籤無關，不呼叫後端、不計次數。 */
export function throwCups(): { cups: [CupFace, CupFace]; result: DivinationResult } {
  const face = (): CupFace => (secureRandomInt(2) === 0 ? 'flat' : 'round');
  const cups: [CupFace, CupFace] = [face(), face()];
  const result: DivinationResult = cups[0] !== cups[1] ? 'sheng' : cups[0] === 'flat' ? 'xiao' : 'yin';
  return { cups, result };
}
