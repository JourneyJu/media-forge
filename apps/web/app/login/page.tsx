"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { changePassword, login, refreshAccessToken } from "../lib/auth-api";

type LoginState =
  | { status: "idle"; message: string }
  | { status: "submitting"; message: string }
  | { status: "error"; message: string }
  | { status: "success"; message: string };

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [step, setStep] = useState<"login" | "change_password">("login");
  const [state, setState] = useState<LoginState>({ status: "idle", message: "请输入账号和密码" });

  function redirectAfterLogin(): void {
    const nextPath = searchParams.get("next");
    router.push(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmedAccount = account.trim();
    if (!trimmedAccount || !password) {
      setState({ status: "error", message: "请填写账号和密码" });
      return;
    }

    setState({ status: "submitting", message: "正在登录..." });
    try {
      const result = await login({ account: trimmedAccount, password });
      if (result.user.mustChangePassword) {
        setAccessToken(result.accessToken);
        setStep("change_password");
        setState({ status: "success", message: "首次登录需要修改密码" });
        return;
      }
      setState({ status: "success", message: "登录成功，正在进入工作台" });
      redirectAfterLogin();
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "登录失败，请稍后重试" });
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!accessToken) {
      setState({ status: "error", message: "登录状态已失效，请重新登录" });
      setStep("login");
      return;
    }
    const passwordClasses = [
      /[a-z]/u.test(nextPassword),
      /[A-Z]/u.test(nextPassword),
      /\d/u.test(nextPassword),
      /[^A-Za-z0-9]/u.test(nextPassword)
    ].filter(Boolean).length;
    if (nextPassword.length < 9 || passwordClasses < 3) {
      setState({ status: "error", message: "密码至少 9 位，且大写、小写、数字、特殊字符至少包含三类" });
      return;
    }
    if (nextPassword !== confirmPassword) {
      setState({ status: "error", message: "两次输入的新密码不一致" });
      return;
    }
    if (nextPassword === password) {
      setState({ status: "error", message: "新密码不能和初始密码相同" });
      return;
    }

    setState({ status: "submitting", message: "正在更新密码..." });
    try {
      await changePassword({ currentPassword: password, nextPassword }, accessToken);
      await refreshAccessToken();
      setState({ status: "success", message: "密码已更新，正在进入工作台" });
      redirectAfterLogin();
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : "密码修改失败，请稍后重试" });
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand-block" aria-label="MediaForge">
        <span className="brand-mark login-brand-mark" aria-hidden="true">M</span>
        <div>
          <strong className="brand">MediaForge</strong>
          <span className="product-name">公众号创作平台</span>
        </div>
      </div>

      <span className="login-health-pill">
        <i aria-hidden="true" />
        平台基础服务正常
      </span>

      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card-heading">
          <h1 id="login-title">{step === "login" ? "登录 MediaForge" : "设置新密码"}</h1>
          <p>{step === "login" ? "继续你的公众号创作工作台" : "首次登录需要修改初始密码"}</p>
        </div>

        {step === "login" ? (
          <form onSubmit={(event) => void handleSubmit(event)} className="login-form">
            <label htmlFor="account">
              账号
              <span>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M20 21a8 8 0 0 0-16 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="12" cy="7" r="4" stroke="currentColor" strokeWidth="2" />
                </svg>
                <input
                  id="account"
                  name="account"
                  autoComplete="username"
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  placeholder="请输入账号"
                />
              </span>
            </label>

            <label htmlFor="password">
              密码
              <span>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="请输入密码"
                />
                <button
                  className="login-password-toggle"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                >
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" strokeWidth="2" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
              </span>
            </label>

            <button className="login-submit" type="submit" disabled={state.status === "submitting"}>
              {state.status === "submitting" ? "登录中..." : "登录"}
            </button>

            <div className="login-meta">
              <button type="button">忘记密码</button>
              <span>暂无账号？联系管理员</span>
            </div>

            <p className={`login-message login-message-${state.status}`} aria-live="polite">
              {state.message}
            </p>
          </form>
        ) : (
          <form onSubmit={(event) => void handlePasswordChange(event)} className="login-form">
            <label htmlFor="next-password">
              新密码
              <span>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  id="next-password"
                  name="nextPassword"
                  type="password"
                  autoComplete="new-password"
                  value={nextPassword}
                  onChange={(event) => setNextPassword(event.target.value)}
                  placeholder="至少 9 位，四类字符中包含三类"
                />
              </span>
            </label>

            <label htmlFor="confirm-password">
              确认新密码
              <span>
                <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path d="M20 7 10 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <input
                  id="confirm-password"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入新密码"
                />
              </span>
            </label>

            <button className="login-submit" type="submit" disabled={state.status === "submitting"}>
              {state.status === "submitting" ? "保存中..." : "保存并进入"}
            </button>

            <div className="login-meta">
              <button type="button" onClick={() => setStep("login")}>返回登录</button>
              <span>{account || "admin"}</span>
            </div>

            <p className={`login-message login-message-${state.status}`} aria-live="polite">
              {state.message}
            </p>
          </form>
        )}
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-page" aria-busy="true" />}>
      <LoginForm />
    </Suspense>
  );
}
