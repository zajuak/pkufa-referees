import { useEffect, useState } from 'react';
import { api, useData } from '../hooks/useData';
import { downloadBlob } from '../domain/downloads';

type Account = { refereeId: string; version: number; updatedAt: string };
export default function QueryAccountManager() {
  const { data } = useData();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState<{ refereeId: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => api<Account[]>('/api/accounts').then(setAccounts);
  useEffect(() => { refresh().catch((e) => setMessage(e.message)); }, []);
  const create = async (refereeId: string, reset: boolean) => {
    if (reset && !confirm('重置后旧密码和所有旧登录状态立即失效，确定继续？')) return;
    setBusy(true); setMessage(''); setCredential(null);
    try { const result = await api<{ refereeId: string; password: string }>('/api/accounts', { method: 'POST', body: JSON.stringify({ refereeId }) }); setCredential(result); await refresh(); }
    catch (e) { setMessage(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const name = (id: string) => data!.referees.find((r) => r.id === id)?.name || id;
  return <section className="admin-section"><div className="admin-section-heading"><div><h2>裁判员查询账号</h2><p>为裁判员开通独立查询密码。每人只能读取本人积分、工资和奖惩，无权修改业务数据。</p></div></div><input aria-label="搜索查询账号" className="account-search" placeholder="搜索姓名或档案编号" value={query} onChange={(e) => setQuery(e.target.value)} />{credential && <div className="restore-review"><h3>{name(credential.refereeId)}的查询密码</h3><p>账号：{credential.refereeId}</p><p>初始密码：<code>{credential.password}</code></p><p>本次生成的密码仅在这里显示，请单独交给本人。裁判员可在登录后修改密码。</p><button className="button secondary" onClick={() => downloadBlob(`${name(credential.refereeId)}-查询账号.txt`, `北大足协裁判个人查询\n网址：https://zajuak.github.io/pkufa-referees/#/referees\n姓名：${name(credential.refereeId)}\n账号：${credential.refereeId}\n初始密码：${credential.password}\n请勿转发给其他人，登录后可修改密码。\n`, 'text/plain;charset=utf-8')}>下载本人的登录信息</button><button className="button secondary" onClick={() => setCredential(null)}>已记录，关闭</button></div>}{message && <p className="form-error" role="alert">{message}</p>}<div className="account-list">{data!.referees.filter((r) => `${r.name} ${r.id}`.includes(query.trim())).map((r) => { const account = accounts.find((a) => a.refereeId === r.id); return <div className="operation-row" key={r.id}><div><strong>{r.name}</strong><p>{r.id} · {account ? `已开通 · ${new Date(account.updatedAt).toLocaleDateString('zh-CN')}` : '尚未开通个人查询'}</p></div><button className="button secondary" disabled={busy} onClick={() => void create(r.id, !!account)}>{account ? '重置密码' : '开通查询'}</button></div>; })}</div></section>;
}
