"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ModelConfig, ModelConnection, ModelRoute } from "@mediaforge/contracts";
import {
  disableModelConfig,
  disableModelConnection,
  listModelConfigs,
  listModelConnections,
  listModelRoutes,
  saveModelConfig,
  saveModelConnection,
  testModelConnection,
  updateModelRoute,
  validateModelConfig
} from "../../lib/admin-api";

type Panel =
  | { type: "connection"; value?: ModelConnection }
  | { type: "model"; value?: ModelConfig }
  | null;

export default function ModelsPage() {
  const [connections, setConnections] = useState<ModelConnection[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [routes, setRoutes] = useState<ModelRoute[]>([]);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [modality, setModality] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("正在加载模型配置...");
  const [panel, setPanel] = useState<Panel>(null);

  const load = useCallback(async () => {
    try {
      const [nextConnections, nextModels, nextRoutes] = await Promise.all([
        listModelConnections(), listModelConfigs(), listModelRoutes()
      ]);
      setConnections(nextConnections);
      setModels(nextModels);
      setRoutes(nextRoutes);
      setRouteDrafts(Object.fromEntries(nextRoutes.map((route) => [route.routeKey, route.modelConfigId ?? ""])));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "模型配置加载失败");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredModels = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return models.filter((model) =>
      (!keyword || model.displayName.toLowerCase().includes(keyword) || model.modelId.toLowerCase().includes(keyword))
      && (!modality || model.modality === modality)
      && (!status || model.status === status)
    );
  }, [models, search, modality, status]);

  async function run(action: () => Promise<unknown>, success: string) {
    try {
      setMessage("正在执行...");
      await action();
      setMessage(success);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function saveRoute(route: ModelRoute) {
    const modelConfigId = routeDrafts[route.routeKey];
    if (!modelConfigId || modelConfigId === route.modelConfigId) return;
    const model = models.find((item) => item.id === modelConfigId);
    if (!window.confirm(`确认将${route.routeKey === "text_generation" ? "文本生成" : "多模态生成"}切换为“${model?.displayName ?? modelConfigId}”？`)) {
      setRouteDrafts((current) => ({ ...current, [route.routeKey]: route.modelConfigId ?? "" }));
      return;
    }
    await run(() => updateModelRoute(route, modelConfigId), "默认模型已切换");
  }

  return (
    <>
      <header className="admin-page-heading">
        <div><span>AI 基础设施</span><h1>模型配置</h1><p>统一维护连接、模型能力与系统默认路由。</p></div>
        <div className="admin-heading-actions">
          <button type="button" onClick={() => setPanel({ type: "connection" })}>新建连接</button>
          <button className="admin-primary" type="button" onClick={() => setPanel({ type: "model" })}>添加模型</button>
        </div>
      </header>

      {message && <p className="admin-notice" role="status">{message}</p>}

      <section className="admin-band">
        <header><div><span>默认能力路由</span><h2>生成任务使用哪个模型</h2></div></header>
        <div className="route-grid">
          {routes.map((route) => {
            const options = models.filter((model) => model.status === "active"
              && (route.routeKey === "text_generation"
                ? model.supportsTextInput
                : model.modality === "multimodal" && model.supportsImageInput));
            return (
              <div className="route-control" key={route.routeKey}>
                <label htmlFor={`route-${route.routeKey}`}>
                  <strong>{route.routeKey === "text_generation" ? "文本生成" : "多模态生成"}</strong>
                  <small>{route.routeKey === "text_generation" ? "文本输入任务" : "包含图片输入的任务"}</small>
                </label>
                <div>
                  <select
                    id={`route-${route.routeKey}`}
                    value={routeDrafts[route.routeKey] ?? ""}
                    onChange={(event) => setRouteDrafts((current) => ({ ...current, [route.routeKey]: event.target.value }))}
                  >
                    <option value="" disabled>请选择已验证模型</option>
                    {options.map((model) => <option value={model.id} key={model.id}>{model.displayName}</option>)}
                  </select>
                  <button
                    type="button"
                    disabled={!routeDrafts[route.routeKey] || routeDrafts[route.routeKey] === route.modelConfigId}
                    onClick={() => void saveRoute(route)}
                  >
                    应用
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="admin-band">
        <header><div><span>供应商连接</span><h2>API 连接</h2></div><small>密钥只可替换，不会回显</small></header>
        <div className="model-list">
          {connections.map((connection) => (
            <article key={connection.id}>
              <div className="model-icon">API</div>
              <div><strong>{connection.name}</strong><small>{connection.baseUrl}</small></div>
              <span className={`status-dot ${connection.status}`}>{statusLabel(connection.status)}</span>
              <span>{connection.secretConfigured ? "密钥已配置" : "未配置密钥"}</span>
              <div className="admin-row-actions">
                <button type="button" onClick={() => setPanel({ type: "connection", value: connection })}>编辑</button>
                <button type="button" disabled={connection.status === "disabled"} onClick={() => void run(() => testModelConnection(connection.id), "连接测试完成")}>测试</button>
                <button
                  type="button"
                  disabled={connection.status === "disabled"}
                  onClick={() => window.confirm(`确认停用连接“${connection.name}”？`) && void run(() => disableModelConnection(connection.id), "连接已停用")}
                >
                  停用
                </button>
              </div>
            </article>
          ))}
          {!connections.length && <p className="admin-empty">尚未添加供应商连接</p>}
        </div>
      </section>

      <section className="admin-band">
        <header><div><span>模型能力</span><h2>已配置模型</h2></div><small>多模态模型可接收图片输入</small></header>
        <div className="admin-toolbar model-toolbar">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索显示名称或模型 ID" />
          <select value={modality} onChange={(event) => setModality(event.target.value)}>
            <option value="">全部模态</option><option value="text">文本</option><option value="multimodal">多模态</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">全部状态</option><option value="draft">待验证</option><option value="active">可用</option><option value="disabled">已停用</option>
          </select>
          <span>{filteredModels.length} 个模型</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>模型</th><th>模态</th><th>能力</th><th>上下文</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {filteredModels.map((model) => (
                <tr key={model.id}>
                  <td><strong>{model.displayName}</strong><small>{model.modelId}</small></td>
                  <td><span className={`modality ${model.modality}`}>{model.modality === "multimodal" ? "多模态" : "文本"}</span></td>
                  <td>{[model.supportsTextInput && "文本", model.supportsImageInput && "图片", model.supportsStructuredOutput && "JSON"].filter(Boolean).join(" / ")}</td>
                  <td>{model.contextWindow?.toLocaleString() ?? "未填写"}</td>
                  <td><span className={`status-dot ${model.status}`}>{modelStatusLabel(model)}</span></td>
                  <td className="admin-row-actions">
                    <button type="button" onClick={() => setPanel({ type: "model", value: model })}>编辑</button>
                    <button type="button" disabled={model.status === "disabled"} onClick={() => void run(() => validateModelConfig(model.id), "模型验证完成")}>验证</button>
                    <button
                      type="button"
                      disabled={model.status === "disabled"}
                      onClick={() => window.confirm(`确认停用模型“${model.displayName}”？`) && void run(() => disableModelConfig(model.id), "模型已停用")}
                    >
                      停用
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredModels.length && <tr><td colSpan={6} className="admin-empty">没有符合条件的模型</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {panel?.type === "connection" && (
        <ConnectionDialog value={panel.value} onClose={() => setPanel(null)} onSaved={() => void load()} />
      )}
      {panel?.type === "model" && (
        <ModelDialog value={panel.value} connections={connections} onClose={() => setPanel(null)} onSaved={() => void load()} />
      )}
    </>
  );
}

function statusLabel(status: ModelConnection["status"]) {
  return status === "active" ? "可用" : status === "disabled" ? "已停用" : "待测试";
}

function modelStatusLabel(model: ModelConfig) {
  if (model.status === "disabled") return "已停用";
  if (model.lastValidationStatus === "success") return "已验证";
  if (model.lastValidationStatus === "failed") return "验证失败";
  return "待验证";
}

function ConnectionDialog({ value, onClose, onSaved }: {
  value?: ModelConnection; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await saveModelConnection({
        name, baseUrl, adapterType: "openai_compatible",
        ...(apiKey ? { apiKey } : {}),
        ...(value ? { version: value.version } : {})
      }, value?.id);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }
  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
      <form className="admin-modal" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>OpenAI Compatible</span><h2>{value ? "编辑模型连接" : "新建模型连接"}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <label>连接名称<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Base URL<input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://gateway.example.com/v1" /></label>
        <label>API Key<input required={!value?.secretConfigured} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={value ? "留空则保留原密钥" : ""} /></label>
        {error && <p className="admin-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>取消</button><button className="admin-primary" type="submit">保存连接</button></footer>
      </form>
    </div>
  );
}

function ModelDialog({ value, connections, onClose, onSaved }: {
  value?: ModelConfig; connections: ModelConnection[]; onClose: () => void; onSaved: () => void;
}) {
  const [connectionId, setConnectionId] = useState(value?.connectionId ?? connections.find((item) => item.status === "active")?.id ?? "");
  const [displayName, setDisplayName] = useState(value?.displayName ?? "");
  const [modelId, setModelId] = useState(value?.modelId ?? "");
  const [modality, setModality] = useState<"text" | "multimodal">(value?.modality ?? "text");
  const [structured, setStructured] = useState(value?.supportsStructuredOutput ?? true);
  const [contextWindow, setContextWindow] = useState(value?.contextWindow?.toString() ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(value?.maxOutputTokens?.toString() ?? "");
  const [temperature, setTemperature] = useState(value?.temperatureDefault.toString() ?? "0.5");
  const [timeoutMs, setTimeoutMs] = useState(value?.timeoutMs.toString() ?? "60000");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await saveModelConfig({
        connectionId, displayName, modelId, modality,
        supportsTextInput: true,
        supportsImageInput: modality === "multimodal",
        supportsStructuredOutput: structured,
        contextWindow: contextWindow ? Number(contextWindow) : null,
        maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : null,
        temperatureDefault: Number(temperature),
        timeoutMs: Number(timeoutMs),
        ...(value ? { version: value.version } : {})
      }, value?.id);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    }
  }
  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose}>
      <form className="admin-modal" onSubmit={(event) => void submit(event)} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>能力定义</span><h2>{value ? "编辑模型" : "添加模型"}</h2></div><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        <label>模型连接<select required value={connectionId} onChange={(event) => setConnectionId(event.target.value)}><option value="">请选择</option>{connections.filter((item) => item.status === "active" || item.id === value?.connectionId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>显示名称<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label>模型 ID<input required value={modelId} onChange={(event) => setModelId(event.target.value)} /></label>
        <label>模型模态<select value={modality} onChange={(event) => setModality(event.target.value as "text" | "multimodal")}><option value="text">纯文本</option><option value="multimodal">多模态（图片输入）</option></select></label>
        <div className="admin-form-grid">
          <label>上下文窗口<input type="number" min="1" value={contextWindow} onChange={(event) => setContextWindow(event.target.value)} placeholder="可选" /></label>
          <label>最大输出 Token<input type="number" min="1" value={maxOutputTokens} onChange={(event) => setMaxOutputTokens(event.target.value)} placeholder="可选" /></label>
          <label>默认温度<input required type="number" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(event.target.value)} /></label>
          <label>超时毫秒<input required type="number" min="1000" max="300000" value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} /></label>
        </div>
        <label className="admin-check"><input type="checkbox" checked={structured} onChange={(event) => setStructured(event.target.checked)} />支持结构化 JSON 输出</label>
        {error && <p className="admin-error">{error}</p>}
        <footer><button type="button" onClick={onClose}>取消</button><button className="admin-primary" type="submit">保存模型</button></footer>
      </form>
    </div>
  );
}
