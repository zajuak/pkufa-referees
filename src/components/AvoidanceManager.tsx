import { useState, type FormEvent } from 'react';
import { api, useData } from '../hooks/useData';
import type { Referee } from '../domain/types';

const normalizeCollegeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const normalizeSearch = (value: string) => value.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase();

export default function AvoidanceManager({ mode = 'all' }: { mode?: 'all' | 'colleges' | 'referees' }) {
  const { data, refresh } = useData();
  const [collegeName, setCollegeName] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const colleges = data!.colleges || [];
  const filteredReferees = [...data!.referees]
    .filter((referee) => normalizeSearch(referee.name).includes(normalizeSearch(query.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(filteredReferees.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const visibleReferees = filteredReferees.slice(start, start + pageSize);
  const pagination = (position: '顶部' | '底部') => <nav className="avoidance-pagination" aria-label={`裁判回避分页（${position}）`}>
    <button type="button" className="button secondary" disabled={Boolean(busy) || currentPage === 1} onClick={() => setPage(currentPage - 1)}>上一页</button>
    <label>第 <select aria-label={`回避裁判页码（${position}）`} value={currentPage} disabled={Boolean(busy) || !filteredReferees.length} onChange={(event) => setPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> / {pageCount} 页</label>
    <button type="button" className="button secondary" disabled={Boolean(busy) || currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
  </nav>;

  const notify = (text: string, failed = false) => {
    setMessage(text);
    setError(failed);
  };
  const addCollege = async (event: FormEvent) => {
    event.preventDefault();
    const name = normalizeCollegeName(collegeName);
    if (!name) {
      notify('请输入学院名称。', true);
      return;
    }
    if (colleges.some((college) => normalizeCollegeName(college).toLocaleLowerCase() === name.toLocaleLowerCase())) {
      notify('该学院已经登记。', true);
      return;
    }
    setBusy('add');
    notify('');
    try {
      await api('/api/colleges', { method: 'POST', body: JSON.stringify({ name }) });
      await refresh();
      setCollegeName('');
      notify(`学院“${name}”已登记。`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '学院添加失败', true);
    } finally {
      setBusy('');
    }
  };
  const removeCollege = async (name: string) => {
    setBusy(`college:${name}`);
    notify('');
    try {
      await api(`/api/colleges?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
      await refresh();
      notify(`学院“${name}”已删除。`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '学院删除失败', true);
    } finally {
      setBusy('');
    }
  };
  const toggleCollege = (referee: Referee, college: string, checked: boolean) => {
    setDrafts((current) => {
      const selected = current[referee.id] ?? referee.avoidanceColleges ?? [];
      return {
        ...current,
        [referee.id]: checked ? [...selected, college] : selected.filter((item) => item !== college),
      };
    });
  };
  const saveAvoidance = async (referee: Referee) => {
    const selected = drafts[referee.id] ?? referee.avoidanceColleges ?? [];
    setBusy(`referee:${referee.id}`);
    notify('');
    try {
      await api(`/api/referees/${encodeURIComponent(referee.id)}/avoidance`, {
        method: 'PUT',
        body: JSON.stringify({ colleges: selected }),
      });
      await refresh();
      setDrafts((current) => ({ ...current, [referee.id]: selected }));
      notify(`${referee.name}的回避学院已保存。`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '回避学院保存失败', true);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="admin-section avoidance-manager" aria-busy={Boolean(busy)}>
      <div className="admin-section-heading">
        <div><h2>{mode === 'colleges' ? '学院名录' : mode === 'referees' ? '裁判回避设置' : '学院名录与裁判回避'}</h2><p>{mode === 'referees' ? '为每位裁判选择需要回避的学院；新增学院请在“球队与球衣”的学院名录中登记。' : '登记学院后，可用于球队归属绑定及裁判员档案中的回避设置。'}</p></div>
      </div>
      {mode !== 'referees' && <><form className="admin-form college-add-form" onSubmit={(event) => void addCollege(event)}>
        <div className="form-grid two-cols">
          <label>学院名称<input aria-label="新学院名称" required maxLength={40} value={collegeName} onChange={(event) => setCollegeName(event.target.value)} placeholder="输入学院全称" /></label>
          <div className="form-actions"><button className="button primary" disabled={Boolean(busy)}>{busy === 'add' ? '添加中…' : '添加学院'}</button></div>
        </div>
      </form>
      <div className="college-list" aria-label="已登记学院">
        {colleges.map((college) => (
          <div className="operation-row college-row" key={college}>
            <div><strong>{college}</strong></div>
            <button className="button secondary" aria-label={`删除学院${college}`} disabled={Boolean(busy)} onClick={() => void removeCollege(college)}>{busy === `college:${college}` ? '删除中…' : '删除'}</button>
          </div>
        ))}
        {!colleges.length && <p className="inline-empty college-empty">尚未登记学院，请先添加。</p>}
      </div>
      </>}
      {message && <p className={error ? 'form-error' : 'form-message'} role={error ? 'alert' : 'status'}>{message}</p>}
      {mode !== 'colleges' && <><div className="avoidance-referee-tools">
        <h3>裁判回避设置</h3>
        <div className="admin-list-tools avoidance-search">
          <input aria-label="搜索回避裁判" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索裁判员姓名" />
          <span role="status">共 {filteredReferees.length} 位裁判，显示第 {filteredReferees.length ? start + 1 : 0}—{start + visibleReferees.length} 位，每页 {pageSize} 位</span>
        </div>
        {pagination('顶部')}
      </div>
      <div className="avoidance-referee-list">
        {visibleReferees.map((referee) => {
          const selected = drafts[referee.id] ?? referee.avoidanceColleges ?? [];
          return (
            <div className="operation-row avoidance-referee-row" key={referee.id}>
              <div><strong>{referee.name}</strong><p>{selected.length ? `已选：${selected.join('、')}` : '未设置回避学院'}</p></div>
              <fieldset className="bonus-checks avoidance-college-options">
                <legend>{referee.name}的回避学院</legend>
                {colleges.map((college) => (
                  <label key={college}><input type="checkbox" aria-label={`${referee.name}回避学院${college}`} checked={selected.includes(college)} disabled={Boolean(busy)} onChange={(event) => toggleCollege(referee, college, event.target.checked)} />{college}</label>
                ))}
                {!colleges.length && <p className="avoidance-empty-hint">请先在上方登记学院。</p>}
              </fieldset>
              <button className="button secondary" disabled={Boolean(busy)} onClick={() => void saveAvoidance(referee)}>{busy === `referee:${referee.id}` ? '保存中…' : '保存回避学院'}</button>
            </div>
          );
        })}
        {!visibleReferees.length && <p className="inline-empty">没有匹配的裁判员。</p>}
      </div>
      {pagination('底部')}
      </>}
    </section>
  );
}
