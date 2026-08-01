"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "@mediaforge/contracts";
import { getMe, logout } from "../lib/auth-api";

const navigation = [
  { href: "/admin/users", icon: "U", label: "用户管理" },
  { href: "/admin/models", icon: "M", label: "模型配置" },
  { href: "/admin/usage", icon: "↗", label: "使用监控" }
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    void getMe()
      .then(({ user: current }) => {
        if (current.role !== "admin") {
          router.replace("/");
          return;
        }
        setUser(current);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  if (!user) {
    return <main className="admin-loading">正在验证管理权限...</main>;
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <Link href="/" className="admin-brand" aria-label="返回创作工作台">
          <span className="brand-mark">M</span>
          <span><strong>MediaForge</strong><small>系统设置</small></span>
        </Link>
        <div className="admin-account">
          <span className="admin-avatar">{user.displayName.slice(0, 1)}</span>
          <span><strong>{user.displayName}</strong><small>{user.username}</small></span>
          <button
            type="button"
            title="退出登录"
            aria-label="退出登录"
            onClick={() => void logout().then(() => router.push("/login"))}
          >
            ↪
          </button>
        </div>
      </header>
      <div className="admin-workspace">
        <aside className="admin-sidebar">
          <nav aria-label="系统设置导航">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={pathname === item.href ? "active" : ""}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/" className="admin-back">← 返回创作工作台</Link>
        </aside>
        <section className="admin-content">{children}</section>
      </div>
    </main>
  );
}
