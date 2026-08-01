"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageDashboardResponse } from "@mediaforge/contracts";
import {
  getUsageDashboard,
  getUsageModelDetail,
  getUsageUserDetail,
  type UsageModelDetail,
  type UsageUserDetail
} from "../../lib/admin-api";

function dateDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(Date.now() - days * 86400000));
}

function number(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function rate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function duration(value: number | null): string {
  return value === null ? "—" : value >= 1000 ? `${(value / 1000).toFixed(1)} 秒` : `${Math.round(value)} 毫秒`;
}

export default function UsagePage() {
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState(dateDaysAgo(29));
  const [to, setTo] = useState(dateDaysAgo(0));
  const [metric, setMetric] = useState<"generation" | "tokens">("generation");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<UsageDashboardResponse | null>(null);
  const [detail, setDetail] = useState<UsageUserDetail | UsageModelDetail | null>(null);
  const [message, setMessage] = useState("正在汇总使用数据...");

  const load = useCallback(async () => {
    try {
      setMessage("正在汇总使用数据...");
      const result = await getUsageDashboard(from, to);
      setData(result);
      setDetail(null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "监控数据加载失败");
    }
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  function selectPreset(days: string) {
    setPreset(days);
    setFrom(dateDaysAgo(Number(days) - 1));
    setTo(dateDaysAgo(0));
  }

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return data?.users.filter((row) =>
      !keyword || row.username.toLowerCase().includes(keyword) || row.displayName.toLowerCase().includes(keyword)
    ) ?? [];
  }, [data, search]);
  const maxTrend = Math.max(1, ...(data?.trend.map((point) =>
    metric === "generation" ? point.generationCount : point.totalTokens
  ) ?? [1]));

  async function openUser(userId: string) {
    try {
      setMessage("正在加载用户明细...");
      setDetail(await getUsageUserDetail(userId, from, to));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "用户明细加载失败");
    }
  }

  async function openModel(modelId: string) {
    try {
      setMessage("正在加载模型明细...");
      setDetail(await getUsageModelDetail(modelId, from, to));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模型明细加载失败");
    }
  }

  return (
    <>
      <header className="admin-page-heading">
        <div><span>运营洞察</span><h1>使用监控</h1><p>查看用户生成次数，以及用户和系统总体的模型消耗。</p></div>
        <div className="segmented admin-range">
          {["7", "30"].map((days) => <button type="button" className={preset === days ? "active" : ""} onClick={() => selectPreset(days)} key={days}>{days} 天</button>)}
        </div>
      </header>
      <div className="usage-range-controls">
        <label>开始日期<input type="date" value={from} onChange={(event) => { setPreset("custom"); setFrom(event.target.value); }} /></label>
        <label>结束日期<input type="date" value={to} onChange={(event) => { setPreset("custom"); setTo(event.target.value); }} /></label>
        <button type="button" onClick={() => void load()}>刷新</button>
        <small>最长可查询 180 天，按 Asia/Shanghai 分桶</small>
      </div>
      {message && <p className="admin-notice" role="status">{message}</p>}
      {data && (
        <>
          <section className="metric-strip">
            <article><span>生成次数</span><strong>{data.summary.generationCount.toLocaleString()}</strong><small>{data.summary.generationFailedCount} 次失败</small></article>
            <article><span>活跃用户</span><strong>{data.summary.activeUsers.toLocaleString()}</strong><small>范围内发起过生成</small></article>
            <article><span>总 Token</span><strong>{number(data.summary.totalTokens)}</strong><small>输入 {number(data.summary.inputTokens)} / 输出 {number(data.summary.outputTokens)}</small></article>
            <article><span>生成成功率</span><strong>{rate(data.summary.generationSuccessRate)}</strong><small>{data.summary.generationCancelledCount} 次取消</small></article>
          </section>

          <section className="admin-band">
            <header>
              <div><span>趋势</span><h2>{metric === "generation" ? "每日生成次数" : "每日 Token"}</h2></div>
              <div className="segmented compact-segmented">
                <button type="button" className={metric === "generation" ? "active" : ""} onClick={() => setMetric("generation")}>生成</button>
                <button type="button" className={metric === "tokens" ? "active" : ""} onClick={() => setMetric("tokens")}>Token</button>
              </div>
            </header>
            <div className="usage-chart" aria-label="每日使用趋势">
              {data.trend.map((point) => {
                const value = metric === "generation" ? point.generationCount : point.totalTokens;
                return (
                  <div key={point.date} title={`${point.date}：${number(value)}`}>
                    <i style={{ height: `${Math.max(3, value / maxTrend * 100)}%` }} />
                    <span>{point.date.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="admin-band">
            <header><div><span>用户维度</span><h2>用户使用排行</h2></div></header>
            <div className="usage-table-filter"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索显示名称或用户名" /><span>{filteredUsers.length} 位用户</span></div>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>用户</th><th>生成次数</th><th>Token</th><th>成功率</th><th>模型调用</th></tr></thead>
              <tbody>{filteredUsers.map((row) => <tr className="clickable-row" key={row.userId} onClick={() => void openUser(row.userId)}>
                <td><strong>{row.displayName}</strong><small>@{row.username}</small></td>
                <td>{row.generationCount}</td><td>{number(row.totalTokens)}</td><td>{rate(row.generationSuccessRate)}</td><td>{row.modelCallCount}</td>
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="admin-band">
            <header><div><span>系统总体</span><h2>模型消耗</h2></div><small>{data.summary.modelCallCount} 次调用，平均 {duration(data.summary.averageDurationMs)}</small></header>
            <div className="admin-table-wrap"><table className="admin-table">
              <thead><tr><th>模型</th><th>模态</th><th>调用次数</th><th>Token</th><th>活跃用户</th><th>成功率</th><th>平均耗时</th></tr></thead>
              <tbody>{data.models.map((row) => <tr className="clickable-row" key={row.modelConfigId} onClick={() => void openModel(row.modelConfigId)}>
                <td><strong>{row.modelDisplayName}</strong><small>{row.modelId}</small></td>
                <td>{row.modality === "multimodal" ? "多模态" : "文本"}</td><td>{row.modelCallCount}</td>
                <td>{number(row.totalTokens)}</td><td>{row.activeUserCount}</td><td>{rate(row.modelSuccessRate)}</td><td>{duration(row.averageDurationMs)}</td>
              </tr>)}</tbody>
            </table></div>
          </section>
        </>
      )}
      {detail && <UsageDetail detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function UsageDetail({ detail, onClose }: {
  detail: UsageUserDetail | UsageModelDetail;
  onClose: () => void;
}) {
  const isUser = "user" in detail;
  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
      <section className="admin-modal usage-detail" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>{isUser ? "用户用量详情" : "模型用量详情"}</span><h2>{isUser ? detail.user.displayName : detail.model.modelDisplayName}</h2></div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        {isUser ? (
          <>
            <div className="detail-summary"><span>生成 <strong>{detail.user.generationCount}</strong></span><span>Token <strong>{number(detail.user.totalTokens)}</strong></span><span>成功率 <strong>{rate(detail.user.generationSuccessRate)}</strong></span></div>
            <h3>使用模型</h3>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>模型</th><th>调用</th><th>Token</th><th>成功率</th></tr></thead><tbody>
              {detail.models.map((row) => <tr key={row.modelConfigId}><td>{row.modelDisplayName}</td><td>{row.modelCallCount}</td><td>{number(row.totalTokens)}</td><td>{rate(row.modelSuccessRate)}</td></tr>)}
            </tbody></table></div>
            <h3>最近生成</h3>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>类型</th><th>状态</th><th>模型调用</th><th>时间</th></tr></thead><tbody>
              {detail.recentGenerations.map((row) => <tr key={row.generationId}><td>{row.generationType}</td><td>{row.status}</td><td>{row.modelCallCount}</td><td>{new Date(row.startedAt).toLocaleString("zh-CN")}</td></tr>)}
            </tbody></table></div>
          </>
        ) : (
          <>
            <div className="detail-summary"><span>调用 <strong>{detail.model.modelCallCount}</strong></span><span>Token <strong>{number(detail.model.totalTokens)}</strong></span><span>成功率 <strong>{rate(detail.model.modelSuccessRate)}</strong></span></div>
            <h3>使用用户</h3>
            <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>用户</th><th>调用</th><th>Token</th><th>成功率</th></tr></thead><tbody>
              {detail.users.map((row) => <tr key={row.userId}><td><strong>{row.displayName}</strong><small>@{row.username}</small></td><td>{row.modelCallCount}</td><td>{number(row.totalTokens)}</td><td>{rate(row.modelSuccessRate)}</td></tr>)}
            </tbody></table></div>
          </>
        )}
      </section>
    </div>
  );
}
