import { useRef, useState } from 'react';
import { FileUp, LoaderCircle } from 'lucide-react';
import { requestApi, useData } from '../hooks/useData';
import { CURRENT_SEASON } from '../domain/calculations';
import { competitionEvents } from '../domain/competitions';
import type { CompetitionEvent } from '../domain/types';

interface ImportResult { added: number; updated: number; newReferees: number; total: number }

export default function AssignmentUpload() {
  const { refresh } = useData();
  const input = useRef<HTMLInputElement>(null);
  const [event, setEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setResult(null);
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('请上传 .xlsx 格式文件'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('文件不能超过 5MB'); return; }
    setUploading(true);
    try {
      const response = await requestApi(`/api/import-assignments?season=${encodeURIComponent(CURRENT_SEASON)}&event=${encodeURIComponent(event)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '导入失败');
      setResult(body);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  return (
    <div className="upload-control">
      <label className="upload-event-select">上传赛事<select value={event} onChange={(change) => setEvent(change.target.value as CompetitionEvent)}>{competitionEvents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <input ref={input} type="file" accept=".xlsx" onChange={(change) => void upload(change.target.files?.[0])} aria-label="上传裁判选派 Excel" hidden />
      <button className="button secondary" disabled={uploading} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <FileUp size={17} />}{uploading ? '正在导入…' : '上传选派 Excel'}</button>
      {result && <p className="upload-result">导入完成：新增 {result.added} 场，更新 {result.updated} 场，新增渠道档案 {result.newReferees} 个。</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
