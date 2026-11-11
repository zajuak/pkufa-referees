import { useState, type FormEvent } from 'react';
import { api, useData } from '../hooks/useData';
import type { Referee } from '../domain/types';

const normalizeCollegeName = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const normalizeSearch = (value: string) => value.normalize('NFKC').replace(/\s/g, '').toLocaleLowerCase();

export default function AvoidanceManager() {
  const { data, refresh } = useData();
  const [collegeName, setCollegeName] = useState('');
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const colleges = data!.colleges || [];
  const filteredReferees = [...data!.referees]
    .filter((referee) => normalizeSearch(referee.name).includes(normalizeSearch(query.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  const visibleReferees = filteredReferees.slice(0, 30);

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
        <div><h2>学院名录与裁判回避</h2><p>登记学院后，可设置每位裁判需要回避的学院，并供下方球队绑定使用。</p></div>
      </div>
      <form className="admin-form college-add-form" onSubmit={(event) => void addCollege(event)}>
        <div className="form-grid two-cols">
          <label>学院名称<input aria-label="新学院名称" required maxLength={40} value={collegeName} onChange={(event) => setCollegeName(event.target.value)} placeholder="输入学院全称" /></label>
          <div className="form-actions"><button className="button primary" disabled={Boolean(busy)}>{busy === 'add' ? '添加中…' : '添加学院'}</button></div>
        </div>
      </form>
      {message && <p className={error ? 'form-error' : 'form-message'} role={error ? 'alert' : 'status'}>{message}</p>}
      <div className="college-list" aria-label="已登记学院">
        {colleges.map((college) => (
          <div className="operation-row college-row" key={college}>
            <div><strong>{college}</strong></div>
            <button className="button secondary" aria-label={`删除学院${college}`} disabled={Boolean(busy)} onClick={() => void removeCollege(college)}>{busy === `college:${college}` ? '删除中…' : '删除'}</button>
          </div>
        ))}
        {!colleges.length && <p className="inline-empty college-empty">尚未登记学院，请先添加。</p>}
      </div>
      <div className="avoidance-referee-tools">
        <h3>裁判回避设置</h3>
        <div className="admin-list-tools avoidance-search">
          <input aria-label="搜索回避裁判" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索裁判员姓名" />
          <span role="status">共 {filteredReferees.length} 位裁判，显示 {visibleReferees.length} 位{filteredReferees.length > visibleReferees.length ? '，请搜索缩小范围' : ''}</span>
        </div>
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
    </section>
  );
}
