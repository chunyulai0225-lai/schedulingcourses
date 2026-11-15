import { useCallback, useEffect, useState } from 'react';
import { loadStatistics, type DrawStat } from '../../lib/adminApi';
import { toChineseNumber } from '../../lib/chineseNumber';
import { Button, Card, Messages } from './ui';

const percent = (count: number, total: number) => (total ? ((count / total) * 100).toFixed(2) : '0.00');

function downloadCsv(stats: DrawStat[], total: number) {
  const rows = [['籤號', '籤名', '抽出次數', '比例(%)'], ...stats.map((s) => [
    String(s.fortune_number), `第${toChineseNumber(s.fortune_number)}籤`, String(s.draw_count), percent(s.draw_count, total),
  ]), ['合計', '', String(total), total ? '100.00' : '0.00']];
  // 加上 BOM，Excel 開啟時中文才不會亂碼
  const blob = new Blob(['﻿' + rows.map((r) => r.join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `抽籤統計_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function StatisticsPanel() {
  const [stats, setStats] = useState<DrawStat[]>([]);
  const [sortBy, setSortBy] = useState<'number' | 'count'>('number');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setStats(await loadStatistics()); } catch (e) { setError(`讀取失敗：${(e as Error).message}`); }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const total = stats.reduce((s, r) => s + r.draw_count, 0);
  const sorted = [...stats].sort((a, b) => (sortBy === 'count' ? b.draw_count - a.draw_count || a.fortune_number - b.fortune_number : a.fortune_number - b.fortune_number));
  const max = Math.max(1, ...stats.map((s) => s.draw_count));

  return (
    <Card
      title="匿名抽籤統計"
      actions={<>
        <Button variant="secondary" onClick={refresh} disabled={loading}>{loading ? '讀取中…' : '重新整理'}</Button>
        <Button onClick={() => downloadCsv([...stats].sort((a, b) => a.fortune_number - b.fortune_number), total)} disabled={!stats.length}>匯出 CSV</Button>
      </>}
    >
      <p className="text-sm text-ink-800/80">只統計每支籤被抽出的總次數，不保存任何個人資料或個別抽籤紀錄。擲筊不計入。</p>
      <Messages errors={error ? [error] : []} />
      <p className="mt-4 text-lg text-ink-900">累計抽籤總次數：<strong>{total.toLocaleString('zh-TW')}</strong> 次</p>

      <div className="mt-4 flex gap-2 text-sm" role="group" aria-label="排序方式">
        <Button variant={sortBy === 'number' ? 'primary' : 'secondary'} onClick={() => setSortBy('number')}>依籤號</Button>
        <Button variant={sortBy === 'count' ? 'primary' : 'secondary'} onClick={() => setSortBy('count')}>依次數排行</Button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm text-ink-900">
          <thead>
            <tr className="border-b border-ink-800/20 text-left">
              {sortBy === 'count' && <th className="py-2 pr-3 font-medium">排名</th>}
              <th className="py-2 pr-3 font-medium">籤號</th>
              <th className="py-2 pr-3 text-right font-medium">次數</th>
              <th className="py-2 pr-3 text-right font-medium">比例</th>
              <th className="w-1/3 py-2 font-medium"><span className="sr-only">圖示</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.fortune_number} className="border-b border-ink-800/10">
                {sortBy === 'count' && <td className="py-1.5 pr-3 text-ink-800/60">{i + 1}</td>}
                <td className="py-1.5 pr-3">第{toChineseNumber(s.fortune_number)}籤</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{s.draw_count.toLocaleString('zh-TW')}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{percent(s.draw_count, total)}%</td>
                <td className="py-1.5"><div className="h-2 rounded bg-gold" style={{ width: `${(s.draw_count / max) * 100}%` }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
