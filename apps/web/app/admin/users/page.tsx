"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { AdminUser, AuthRole, UserStatus } from "@mediaforge/contracts";
import {
  createAdminUser,
  getAdminUser,
  listAdminUsers,
  resetAdminUserPassword,
  updateAdminUser
} from "../../lib/admin-api";

const pageSize = 20;

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("正在加载用户...");
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<AuthRole>("user");

  const load = useCallback(async () => {
    try {
      const result = await listAdminUsers(search, status, page, pageSize);
      setUsers(result.items);
      setTotal(result.total);
      setMessage(result.items.length ? "" : "没有符合条件的用户");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户加载失败");
    }
  }, [page, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => { setPage(1); }, [search, status]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    try {
      await createAdminUser({ username, displayName, role });
      setUsername("");
      setDisplayName("");
      setRole("user");
      setShowCreate(false);
      setMessage("用户已创建，初始密码为 12345678");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function openDetail(userId: string) {
    try {
      setSelected(await getAdminUser(userId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户详情加载失败");
    }
  }

  async function saved(user: AdminUser) {
    setSelected(user);
    setMessage("用户信息已更新");
    await load();
  }

  return (
    <>
      <header className="admin-page-heading">
        <div><span>账号与权限</span><h1>用户管理</h1><p>管理系统账号、角色和登录状态。</p></div>
        <button className="admin-primary" type="button" onClick={() => setShowCreate(true)}>新建用户</button>
      </header>

      <div className="admin-toolbar">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索用户名或显示名称" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="状态筛选">
          <option value="">全部状态</option><option value="active">正常</option><option value="disabled">已禁用</option>
        </select>
        <span>共 {total} 个用户</span>
      </div>

      {message && <p className="admin-notice" role="status">{message}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>用户</th><th>角色</th><th>状态</th><th>密码状态</th><th>最近登录</th><th>操作</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong><small>@{user.username}</small></td>
                <td>{user.role === "admin" ? "管理员" : "普通用户"}</td>
                <td><span className={`status-dot ${user.status}`}>{user.status === "active" ? "正常" : "已禁用"}</span></td>
                <td>{user.mustChangePassword ? "待修改" : "已完成"}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "—"}</td>
                <td><button type="button" onClick={() => void openDetail(user.id)}>查看与编辑</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > pageSize && (
        <nav className="admin-pagination" aria-label="用户分页">
          <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
          <span>第 {page} / {Math.ceil(total / pageSize)} 页</span>
          <button type="button" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)}>下一页</button>
        </nav>
      )}

      {selected && <UserDrawer user={selected} onClose={() => setSelected(null)} onSaved={(user) => void saved(user)} />}

      {showCreate && (
        <div className="admin-modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <form className="admin-modal" onSubmit={(event) => void submitCreate(event)} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>新账号</span><h2>创建用户</h2></div><button type="button" aria-label="关闭" onClick={() => setShowCreate(false)}>×</button></header>
            <label>用户名<input required pattern="[A-Za-z0-9_]{3,32}" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="英文、数字或下划线" /></label>
            <label>显示名称<input required maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="支持中英文混合" /></label>
            <label>角色<select value={role} onChange={(event) => setRole(event.target.value as AuthRole)}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
            <p>创建后初始密码为 <strong>12345678</strong>，首次登录必须修改。</p>
            <footer><button type="button" onClick={() => setShowCreate(false)}>取消</button><button className="admin-primary" type="submit">创建用户</button></footer>
          </form>
        </div>
      )}
    </>
  );
}

function UserDrawer({ user, onClose, onSaved }: {
  user: AdminUser; onClose: () => void; onSaved: (user: AdminUser) => void;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<AuthRole>(user.role);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (status !== user.status && !window.confirm(`确认${status === "disabled" ? "禁用" : "启用"}“${user.displayName}”？禁用会立即撤销该用户全部会话。`)) return;
      onSaved(await updateAdminUser(user.id, { displayName, role, status }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function reset() {
    if (!window.confirm(`确认重置“${user.displayName}”的密码？该用户全部会话将立即失效。`)) return;
    try {
      const result = await resetAdminUserPassword(user.id);
      setMessage(`已重置为 ${result.temporaryPassword}，下次登录必须修改密码`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "重置失败");
    }
  }

  return (
    <div className="admin-drawer-backdrop" onMouseDown={onClose}>
      <form className="admin-user-drawer" onSubmit={(event) => void save(event)} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>用户详情</span><h2>{user.displayName}</h2><small>@{user.username}</small></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <dl className="user-meta">
          <div><dt>创建时间</dt><dd>{new Date(user.createdAt).toLocaleString("zh-CN")}</dd></div>
          <div><dt>最近登录</dt><dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "从未登录"}</dd></div>
          <div><dt>密码状态</dt><dd>{user.mustChangePassword ? "等待首次修改" : "已设置正式密码"}</dd></div>
        </dl>
        <label>显示名称<input required maxLength={32} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>角色<select value={role} onChange={(event) => setRole(event.target.value as AuthRole)}><option value="user">普通用户</option><option value="admin">管理员</option></select></label>
        <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as UserStatus)}><option value="active">正常</option><option value="disabled">已禁用</option></select></label>
        <section className="drawer-danger">
          <strong>安全操作</strong>
          <p>重置后临时密码为 12345678，现有登录会话会立即失效。</p>
          <button type="button" onClick={() => void reset()}>重置密码</button>
        </section>
        {message && <p className="admin-notice" role="status">{message}</p>}
        <footer><button type="button" onClick={onClose}>取消</button><button className="admin-primary" type="submit">保存修改</button></footer>
      </form>
    </div>
  );
}
