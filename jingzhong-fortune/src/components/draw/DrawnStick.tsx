import { toChineseNumber } from '../../lib/chineseNumber';

/** 搖出的籤枝：直書籤號。 */
export function DrawnStick({ number }: { number: number }) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex h-60 w-16 flex-col items-center overflow-hidden rounded-md bg-[linear-gradient(90deg,#b8925a,#ecd6a4_50%,#b8925a)] shadow-[0_8px_30px_-10px_rgba(0,0,0,0.8)] sm:h-72 sm:w-[4.5rem]">
        <span className="h-9 w-full shrink-0 bg-vermilion" aria-hidden="true" />
        <h1 className="mt-4 text-3xl font-bold leading-tight text-[#3a1512] [writing-mode:vertical-rl] sm:text-4xl">
          第{toChineseNumber(number)}籤
        </h1>
      </div>
    </div>
  );
}
