"use client";

import { useEffect, useReducer, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  AssistantChatMessage,
  BuiltInLayoutSkillId,
  ChatMessage,
  ClarificationChatMessage,
  ConversationListItem,
  GenerateWechatArticleResponse,
  ResourceSummary,
  ResultNoticeChatMessage,
  RunEventType,
  TaskCardChatMessage,
  TaskCardStatus,
  TaskStepView,
  AuthUser
} from "@mediaforge/contracts";
import {
  appendConversationTurn,
  createConversation,
  createUploadSession,
  createRunEventSource,
  deleteConversation,
  getArtifact,
  getConversation,
  listConversations,
  parseRunEvent,
  removeStagedResource,
  resolveResourceUrl,
  submitRunClarification,
  uploadResource
} from "./lib/conversations-api";
import { getMe, logout } from "./lib/auth-api";
import { imageUploadLimits, isSupportedUploadImage, prepareImageForUpload, uploadFileSizeValid } from "./lib/image-upload";
import { buildWechatPreviewHtml } from "./lib/wechat-preview";

type PreviewMode = "preview" | "source";

type ChatState = {
  messages: ChatMessage[];
  activeRunId: string | null;
};

type ChatAction =
  | { type: "user_message_added"; message: ChatMessage }
  | { type: "message_removed"; messageId: string }
  | { type: "assistant_message_created"; messageId: string; runId: string; createdAt: string }
  | { type: "assistant_delta_received"; messageId: string; delta: string }
  | { type: "assistant_message_completed"; messageId: string; content?: string }
  | { type: "task_card_updated"; message: TaskCardChatMessage }
  | { type: "clarification_required"; message: ClarificationChatMessage }
  | { type: "result_notice_added"; message: ResultNoticeChatMessage }
  | { type: "clarification_submitted"; runId: string }
  | { type: "restored"; messages: ChatMessage[]; activeRunId: string | null }
  | { type: "run_activated"; runId: string }
  | { type: "reset" };

const starterHtml = `<section style="padding:36px 24px;text-align:center;color:#61706a;">
  <p style="font-size:15px;line-height:1.8;">在对话区告诉 AI 你的创作需求，生成后在这里查看手机端公众号预览。</p>
</section>`;

const runEventTypes: RunEventType[] = [
  "run.created",
  "run.started",
  "assistant.message.created",
  "assistant.message.delta",
  "assistant.message.completed",
  "task.card.updated",
  "step.started",
  "step.completed",
  "clarification.required",
  "clarification.submitted",
  "decision.required",
  "decision.submitted",
  "artifact.created",
  "run.completed",
  "run.failed"
];

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === "reset") return { messages: [], activeRunId: null };
  if (action.type === "restored") return { messages: action.messages, activeRunId: action.activeRunId };

  if (action.type === "run_activated") {
    return { ...state, activeRunId: action.runId };
  }

  if (action.type === "user_message_added") {
    return { ...state, messages: [...state.messages, action.message] };
  }

  if (action.type === "message_removed") {
    return { ...state, messages: state.messages.filter((message) => message.id !== action.messageId) };
  }

  if (action.type === "assistant_message_created") {
    if (state.messages.some((message) => message.id === action.messageId)) return state;
    const message: AssistantChatMessage = {
      id: action.messageId,
      type: "assistant",
      runId: action.runId,
      content: "",
      streaming: true,
      createdAt: action.createdAt
    };
    return { ...state, messages: [...state.messages, message] };
  }

  if (action.type === "assistant_delta_received") {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.type !== "assistant" || message.id !== action.messageId) return message;
        if (!message.streaming) return message;
        return { ...message, content: `${message.content}${action.delta}` };
      })
    };
  }

  if (action.type === "assistant_message_completed") {
    return {
      ...state,
      messages: state.messages.map((message) => {
        if (message.type !== "assistant" || message.id !== action.messageId) return message;
        return {
          ...message,
          content: action.content ?? message.content,
          streaming: false
        };
      })
    };
  }

  if (action.type === "task_card_updated") {
    const existingIndex = state.messages.findIndex(
      (message) => message.type === "task" && message.runId === action.message.runId
    );
    if (existingIndex < 0) {
      return { ...state, messages: [...state.messages, action.message] };
    }

    const messages = [...state.messages];
    messages[existingIndex] = action.message;
    return { ...state, messages };
  }

  if (action.type === "clarification_required") {
    if (state.messages.some((message) => message.id === action.message.id)) return state;
    return { ...state, messages: [...state.messages, action.message] };
  }

  if (action.type === "result_notice_added") {
    if (state.messages.some((message) => message.id === action.message.id)) return state;
    return { ...state, messages: [...state.messages, action.message] };
  }

  if (action.type === "clarification_submitted") {
    return {
      ...state,
      messages: state.messages.filter(
        (message) => message.type !== "clarification" || message.runId !== action.runId
      )
    };
  }

  return state;
}

function getString(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const value = payload[key];
  return typeof value === "string" ? value : fallback;
}

function getBoolean(payload: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = payload[key];
  return typeof value === "boolean" ? value : fallback;
}

function getTaskStatus(payload: Record<string, unknown>): TaskCardStatus {
  const value = payload.status;
  if (
    value === "queued" ||
    value === "running" ||
    value === "waiting_clarification" ||
    value === "completed" ||
    value === "failed"
  ) {
    return value;
  }
  return "running";
}

function getTaskSteps(payload: Record<string, unknown>): TaskStepView[] {
  const steps = payload.steps;
  if (!Array.isArray(steps)) return [];

  return steps.flatMap((step) => {
    if (!step || typeof step !== "object") return [];
    const record = step as Record<string, unknown>;
    const id = getString(record, "id");
    const label = getString(record, "label");
    const status = record.status;
    if (!id || !label) return [];
    if (status !== "waiting" && status !== "running" && status !== "completed" && status !== "failed") return [];
    const summary = getString(record, "summary");
    return [{
      id,
      label,
      status,
      ...(summary ? { summary } : {})
    }];
  });
}

function createLocalUserMessage(content: string, resourceIds: string[]): ChatMessage {
  return {
    id: `local-${crypto.randomUUID()}`,
    type: "user",
    content,
    resourceIds,
    createdAt: new Date().toISOString()
  };
}

function getTaskStatusText(status: TaskCardStatus): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "执行中";
  if (status === "waiting_clarification") return "等待补充";
  if (status === "completed") return "已完成";
  return "失败";
}

function getStepMarker(status: TaskStepView["status"]): string {
  if (status === "completed") return "✓";
  if (status === "running") return "•";
  if (status === "failed") return "!";
  return "";
}

function formatConversationTime(value: string): string {
  const date = new Date(value);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return `今天 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

type MessageListProps = {
  messages: ChatMessage[];
  resourcesById: Record<string, ResourceSummary>;
  onClarificationSubmit: (message: ClarificationChatMessage, answers: Record<string, string>) => Promise<void>;
};

function ResourceThumbnails({
  resourceIds,
  resourcesById,
  removable = false,
  onRemove
}: {
  resourceIds: string[];
  resourcesById: Record<string, ResourceSummary>;
  removable?: boolean;
  onRemove?: (resourceId: string) => void;
}) {
  const [galleryOpen, setGalleryOpen] = useState(false);
  const resources = resourceIds.flatMap((id) => resourcesById[id] ?? []);
  if (resources.length === 0) return null;
  const visible = resources.slice(0, 4);
  const remaining = resources.length - visible.length;

  return (
    <>
      <div className="resource-thumbnails" aria-label={`${resources.length} 个图片素材`}>
        {visible.map((resource) => (
          <div className="resource-thumbnail" key={resource.id}>
            <button type="button" onClick={() => setGalleryOpen(true)} title={resource.originalName}>
              <img src={resolveResourceUrl(resource.previewUrl)} alt={resource.originalName} />
            </button>
            {removable && onRemove && (
              <button
                className="resource-remove"
                type="button"
                onClick={() => onRemove(resource.id)}
                aria-label={`移除 ${resource.originalName}`}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {remaining > 0 && (
          <button className="resource-more" type="button" onClick={() => setGalleryOpen(true)}>
            +{remaining}
          </button>
        )}
      </div>
      {galleryOpen && (
        <div className="resource-gallery-backdrop" role="presentation" onClick={() => setGalleryOpen(false)}>
          <section className="resource-gallery" role="dialog" aria-modal="true" aria-label="全部图片素材" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>图片素材 · {resources.length}</strong>
              <button type="button" onClick={() => setGalleryOpen(false)} aria-label="关闭">×</button>
            </header>
            <div>
              {resources.map((resource) => (
                <button key={resource.id} type="button" onClick={() => window.open(resolveResourceUrl(resource.contentUrl), "_blank")}>
                  <img src={resolveResourceUrl(resource.previewUrl)} alt={resource.originalName} />
                  <span>{resource.originalName}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ClarificationCard({
  message,
  onSubmit
}: {
  message: ClarificationChatMessage;
  onSubmit: MessageListProps["onClarificationSubmit"];
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = message.questions.every((question) => !question.required || answers[question.id]?.trim());

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(message, answers);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="clarification-card">
      <strong>{message.title}</strong>
      <p>{message.description}</p>
      {message.questions.map((question) => (
        <div key={question.id} className="clarification-question">
          <span>{question.label}</span>
          <div>
            {question.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={answers[question.id] === suggestion ? "selected" : ""}
                onClick={() => setAnswers((current) => ({ ...current, [question.id]: suggestion }))}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <input
            value={answers[question.id] ?? ""}
            onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            placeholder="也可以自己输入"
          />
        </div>
      ))}
      <button className="clarification-submit" type="button" disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? "正在继续..." : "继续创作"}
      </button>
    </article>
  );
}

function MessageList({ messages, resourcesById, onClarificationSubmit }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <strong>从一句话开始创作</strong>
        <p>可以直接说主题、读者、素材和风格。AI 会在这里回复、拆解任务，并把最终内容同步到右侧手机预览。</p>
      </div>
    );
  }

  return (
    <div className="message-stack">
      {messages.map((message) => {
        if (message.type === "user") {
          return (
            <article key={message.id} className="message-bubble user-bubble">
              <p>{message.content}</p>
              <ResourceThumbnails resourceIds={message.resourceIds} resourcesById={resourcesById} />
            </article>
          );
        }

        if (message.type === "assistant") {
          return (
            <article key={message.id} className="message-bubble assistant-bubble">
              <span>公众号 AI</span>
              <p>{message.content || "正在组织回复..."}</p>
              {message.streaming && <i aria-label="正在流式输出" />}
            </article>
          );
        }

        if (message.type === "task") {
          const completed = message.steps.filter((step) => step.status === "completed").length;
          return (
            <article key={message.id} className={`task-card ${message.collapsed ? "task-card-collapsed" : ""}`}>
              <div className="task-card-header">
                <div>
                  <strong>{message.title}</strong>
                  <span>{getTaskStatusText(message.status)} · {completed}/{message.steps.length} 个步骤</span>
                </div>
              </div>
              {!message.collapsed && (
                <ol>
                  {message.steps.map((step) => (
                    <li key={step.id} className={`task-step task-step-${step.status}`}>
                      <span>{getStepMarker(step.status)}</span>
                      <div>
                        <strong>{step.label}</strong>
                        {step.summary && <p>{step.summary}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        }

        if (message.type === "clarification") {
          return (
            <ClarificationCard key={message.id} message={message} onSubmit={onClarificationSubmit} />
          );
        }

        return (
          <article key={message.id} className="result-notice">
            <span>结果已更新</span>
            <p>{message.content}</p>
          </article>
        );
      })}
    </div>
  );
}

type AccountMenuProps = {
  open: boolean;
  loggingOut: boolean;
  user: AuthUser | null;
  onToggle: () => void;
  onSettings: () => void;
  onLogout: () => Promise<void>;
};

function AccountMenu({ open, loggingOut, user, onToggle, onSettings, onLogout }: AccountMenuProps) {
  const menuItems = [
    {
      label: "账号安全",
      onClick: undefined,
      icon: (
        <path d="M12 3l7 3v5c0 4.2-2.8 7.9-7 10-4.2-2.1-7-5.8-7-10V6l7-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      )
    },
    {
      label: "权限范围",
      onClick: undefined,
      icon: (
        <>
          <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="2" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M17 10a2.5 2.5 0 1 0 0-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M18 19a4.2 4.2 0 0 0-2.2-3.7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>
      )
    },
    ...(user?.role === "admin" ? [{
      label: "系统设置",
      onClick: onSettings,
      icon: (
        <>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6l-.09.1a2 2 0 1 1-3.82 0L10 20a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1l-.1-.09a2 2 0 1 1 0-3.82L4 10a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6l.09-.1a2 2 0 1 1 3.82 0L14 4a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.35.43.68.6 1l.1.09a2 2 0 1 1 0 3.82L20 14c-.17.32-.37.65-.6 1Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )
    }] : [])
  ];

  return (
    <div className="account-capsule">
      <button
        className="account-trigger"
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="打开账户菜单"
      >
        <span className="account-avatar" aria-hidden="true">{user?.displayName.slice(0, 1) ?? "用"}</span>
        <svg className="account-chevron" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="account-dropdown" role="menu" aria-label="账户菜单">
          <div className="account-dropdown-profile">
            <span className="account-profile-avatar" aria-hidden="true">{user?.displayName.slice(0, 1) ?? "用"}</span>
            <div>
              <strong>{user?.displayName ?? "当前用户"}</strong>
              <span className="account-profile-role">{user?.role === "admin" ? "Admin" : "User"}</span>
              <p>@{user?.username ?? "loading"}</p>
            </div>
          </div>

          <div className="account-dropdown-divider" aria-hidden="true" />

          {menuItems.map((item) => (
            <button className="account-menu-item" type="button" role="menuitem" onClick={item.onClick} aria-disabled={!item.onClick} key={item.label}>
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none">
                {item.icon}
              </svg>
              <span>{item.label}</span>
              <svg className="account-menu-arrow" aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
                <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}

          <div className="account-dropdown-divider" aria-hidden="true" />

          <button
            className="account-panel-logout"
            type="button"
            role="menuitem"
            onClick={() => void onLogout()}
            disabled={loggingOut}
          >
            {loggingOut ? "正在退出..." : "退出登录"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [layoutSkill, setLayoutSkill] = useState<BuiltInLayoutSkillId>("auto");
  const [mode, setMode] = useState<PreviewMode>("preview");
  const [result, setResult] = useState<GenerateWechatArticleResponse | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [uploadSessionId, setUploadSessionId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ResourceSummary[]>([]);
  const [resourcesById, setResourcesById] = useState<Record<string, ResourceSummary>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [chat, dispatch] = useReducer(chatReducer, { messages: [], activeRunId: null });
  const assetInputRef = useRef<HTMLInputElement>(null);
  const lastRunEventNoRef = useRef(0);
  const loadingArtifactIdsRef = useRef(new Set<string>());
  const messageListRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getMe().then((result) => setCurrentUser(result.user)).catch(() => undefined);
  }, []);

  const previewResources = assets.length > 0 ? assets : Object.values(resourcesById);
  const html = result ? buildWechatPreviewHtml(
    result.document,
    previewResources.map((resource) => ({
      id: resource.id,
      name: resource.originalName,
      dataUrl: resolveResourceUrl(resource.contentUrl)
    })),
    layoutSkill
  ) : starterHtml;
  const warningCount = result?.render.warnings.length ?? 0;

  useEffect(() => {
    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [chat.messages]);

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointerDown(event: PointerEvent): void {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!chat.activeRunId) return;

    const source = createRunEventSource(chat.activeRunId, lastRunEventNoRef.current);

    const loadArtifact = (artifactId: string) => {
      if (loadingArtifactIdsRef.current.has(artifactId)) return;
      loadingArtifactIdsRef.current.add(artifactId);
      void getArtifact(artifactId).then((artifact) => {
        setResult(artifact.payload);
        setStatus("预览已更新");
      }).catch((error) => {
        loadingArtifactIdsRef.current.delete(artifactId);
        setStatus(error instanceof Error ? error.message : "产物读取失败");
      });
    };

    const handleRunEvent = (type: RunEventType, event: MessageEvent<string>) => {
      const eventNo = Number(event.lastEventId);
      if (Number.isFinite(eventNo)) {
        lastRunEventNoRef.current = Math.max(lastRunEventNoRef.current, eventNo);
      }

      const payload = parseRunEvent(event);
      const runId = getString(payload, "runId", chat.activeRunId ?? "");

      if (type === "assistant.message.created") {
        dispatch({
          type: "assistant_message_created",
          messageId: getString(payload, "messageId", `assistant-${event.lastEventId}`),
          runId,
          createdAt: new Date().toISOString()
        });
        return;
      }

      if (type === "assistant.message.delta") {
        dispatch({
          type: "assistant_delta_received",
          messageId: getString(payload, "messageId", `assistant-${event.lastEventId}`),
          delta: getString(payload, "delta")
        });
        return;
      }

      if (type === "assistant.message.completed") {
        dispatch({
          type: "assistant_message_completed",
          messageId: getString(payload, "messageId", `assistant-${event.lastEventId}`),
          content: getString(payload, "content") || undefined
        });
        return;
      }

      if (type === "task.card.updated") {
        dispatch({
          type: "task_card_updated",
          message: {
            id: `task-${runId}`,
            type: "task",
            runId,
            title: getString(payload, "title", "公众号创作任务"),
            status: getTaskStatus(payload),
            steps: getTaskSteps(payload),
            collapsed: getBoolean(payload, "collapsed", false),
            createdAt: new Date().toISOString()
          }
        });
        return;
      }

      if (type === "clarification.required" || type === "decision.required") {
        dispatch({
          type: "clarification_required",
          message: {
            id: `clarification-${runId}-${event.lastEventId}`,
            type: "clarification",
            runId,
            title: getString(payload, "title", "还需要补充一点信息"),
            description: getString(payload, "description", getString(payload, "prompt", "请补充关键信息后继续。")),
            questions: Array.isArray(payload.questions)
              ? payload.questions as ClarificationChatMessage["questions"]
              : [],
            createdAt: new Date().toISOString()
          }
        });
        setStatus("等待你补充信息");
        return;
      }

      if (type === "artifact.created" && typeof payload.artifactId === "string") {
        loadArtifact(payload.artifactId);
        return;
      }

      if (type === "run.completed") {
        const artifactId = getString(payload, "artifactId");
        if (artifactId) loadArtifact(artifactId);
        if (artifactId) {
          dispatch({
            type: "result_notice_added",
            message: {
              id: `result-${runId}`,
              type: "result_notice",
              runId,
              artifactId,
              content: "已生成公众号预览，可以在右侧查看并复制 HTML。",
              createdAt: new Date().toISOString()
            }
          });
        }
        setStatus("创作完成");
        source.close();
        return;
      }

      if (type === "run.failed") {
        setStatus(getString(payload, "message", "Agent 执行失败"));
        source.close();
      }
    };

    for (const type of runEventTypes) {
      source.addEventListener(type, (event) => handleRunEvent(type, event as MessageEvent<string>));
    }
    source.onerror = () => setStatus("事件流暂时中断，浏览器会自动重连");

    return () => source.close();
  }, [chat.activeRunId]);

  async function refreshHistory(): Promise<void> {
    try {
      const response = await listConversations();
      setConversations(response.items);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "历史会话读取失败");
    }
  }

  function startNewConversation(): void {
    setTopic("");
    setResult(null);
    setConversationId(null);
    setUploadSessionId(null);
    setAssets([]);
    setResourcesById({});
    lastRunEventNoRef.current = 0;
    dispatch({ type: "reset" });
    setStatus("已新建空白创作");
  }

  async function openConversation(targetId: string): Promise<void> {
    setBusy(true);
    setStatus("正在读取历史会话...");
    try {
      const snapshot = await getConversation(targetId);
      const restoredMessages: ChatMessage[] = snapshot.messages
        .filter((message) => message.role !== "system")
        .map((message) => message.role === "user"
          ? {
              id: message.id,
              type: "user" as const,
              content: message.content,
              resourceIds: message.resourceIds,
              createdAt: message.createdAt
            }
          : {
              id: message.id,
              type: "assistant" as const,
              content: message.content,
              streaming: false,
              createdAt: message.createdAt
            });
      const resourceEntries = snapshot.messages.flatMap((message) => message.resources ?? []);
      setResourcesById(Object.fromEntries(resourceEntries.map((resource) => [resource.id, resource])));
      setAssets([]);
      setUploadSessionId(null);
      setConversationId(snapshot.conversation.id);
      lastRunEventNoRef.current = 0;
      const activeRun = snapshot.activeRun;
      const resumableRunId = activeRun && !["completed", "failed", "cancelled"].includes(activeRun.status)
        ? activeRun.id
        : null;
      dispatch({ type: "restored", messages: restoredMessages, activeRunId: resumableRunId });
      const latestArtifact = snapshot.latestArtifacts.at(-1);
      setResult(latestArtifact?.payload ?? null);
      setStatus(resumableRunId ? "正在恢复创作进度" : "已打开历史会话");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "会话读取失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeConversation(targetId: string): Promise<void> {
    if (!window.confirm("删除后会同时清理该会话的消息、图片和生成结果，确定删除吗？")) return;
    try {
      await deleteConversation(targetId);
      setConversations((current) => current.filter((conversation) => conversation.id !== targetId));
      if (conversationId === targetId) startNewConversation();
      setStatus("会话已删除，相关数据正在清理");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "会话删除失败");
    }
  }

  async function handleGenerate() {
    const content = topic.trim();
    if (!content) {
      setStatus("请先填写创作需求");
      return;
    }

    const resourceIds = assets.map((asset) => asset.id);
    const optimisticMessage = createLocalUserMessage(content, resourceIds);
    dispatch({ type: "user_message_added", message: optimisticMessage });
    setTopic("");
    setBusy(true);
    setStatus("正在创建创作任务...");

    try {
      const input = {
        idempotencyKey: crypto.randomUUID(),
        content,
        ...(uploadSessionId ? { uploadSessionId } : {}),
        resourceIds,
        layoutSkillId: layoutSkill,
        maxSteps: 12
      };
      const response = conversationId
        ? await appendConversationTurn(conversationId, input)
        : await createConversation(input);
      setConversationId(response.conversation.id);
      setResourcesById((current) => ({
        ...current,
        ...Object.fromEntries(response.resources.map((resource) => [resource.id, resource]))
      }));
      setAssets([]);
      setUploadSessionId(null);
      lastRunEventNoRef.current = 0;
      dispatch({ type: "run_activated", runId: response.run.id });
      if (response.run.resultArtifact) setResult(response.run.resultArtifact.payload);
      await refreshHistory();
      setStatus("Agent 正在对话中更新进度");
    } catch (error) {
      dispatch({ type: "message_removed", messageId: optimisticMessage.id });
      setTopic(content);
      setStatus(error instanceof Error ? error.message : "文章生成失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleClarificationSubmit(
    message: ClarificationChatMessage,
    answers: Record<string, string>
  ) {
    const answerText = message.questions
      .map((question) => answers[question.id]?.trim())
      .filter(Boolean)
      .join("；");
    try {
      await submitRunClarification(message.runId, {
        idempotencyKey: crypto.randomUUID(),
        answers: Object.entries(answers)
          .filter(([, value]) => value.trim())
          .map(([questionId, value]) => ({ questionId, value: value.trim() }))
      });
      if (answerText) {
        dispatch({ type: "user_message_added", message: createLocalUserMessage(answerText, []) });
      }
      dispatch({ type: "clarification_submitted", runId: message.runId });
      setStatus("已补充信息，正在继续创作");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "追问信息提交失败，请重试");
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(html);
      setStatus("HTML 已复制，可以粘贴到公众号后台");
    } catch {
      setStatus("浏览器未允许复制，请切换源码后手动复制");
      setMode("source");
    }
  }

  async function persistFiles(files: File[], source: "upload" | "paste"): Promise<void> {
    const accepted = files.filter((file) => isSupportedUploadImage(file) && uploadFileSizeValid(file));
    if (accepted.length !== files.length) {
      setStatus(`仅支持 JPG、PNG、WebP 或 GIF；非 GIF 大图会先压缩，原图最大 ${Math.round(imageUploadLimits.maxCompressSourceBytes / 1024 / 1024)} MB`);
    }
    if (accepted.length === 0) return;
    setBusy(true);
    setStatus(`正在处理 ${accepted.length} 张图片...`);
    try {
      let sessionId = uploadSessionId;
      if (!sessionId) {
        const session = await createUploadSession({ idempotencyKey: crypto.randomUUID() });
        sessionId = session.id;
        setUploadSessionId(session.id);
      }
      const uploaded: ResourceSummary[] = [];
      for (let index = 0; index < accepted.length; index += 3) {
        const batch = accepted.slice(index, index + 3);
        const prepared = await Promise.all(batch.map((file) => prepareImageForUpload(file)));
        setStatus(`正在上传图片 ${Math.min(index + prepared.length, accepted.length)}/${accepted.length}...`);
        uploaded.push(...await Promise.all(prepared.map((file) => uploadResource(sessionId!, file, source))));
      }
      setAssets((current) => [...current, ...uploaded]);
      setResourcesById((current) => ({
        ...current,
        ...Object.fromEntries(uploaded.map((resource) => [resource.id, resource]))
      }));
      setStatus(`已保存 ${uploaded.length} 张图片`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function handleAssetSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await persistFiles(files, "upload");
  }

  async function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): Promise<void> {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .flatMap((item) => item.getAsFile() ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    await persistFiles(files, "paste");
  }

  async function removeAsset(assetId: string): Promise<void> {
    if (!uploadSessionId) return;
    try {
      await removeStagedResource(uploadSessionId, assetId);
      setAssets((current) => current.filter((asset) => asset.id !== assetId));
      setResourcesById((current) => {
        const next = { ...current };
        delete next[assetId];
        return next;
      });
      setStatus("已移除图片");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片移除失败");
    }
  }

  async function handleLogout(): Promise<void> {
    setLoggingOut(true);
    try {
      await logout();
      router.push("/login");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "退出登录失败，请稍后重试");
      setLoggingOut(false);
    }
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true">M</span>
          <div>
            <strong className="brand">MediaForge</strong>
            <span className="product-name">公众号创作平台</span>
          </div>
        </div>
        <div className="topbar-actions" ref={accountMenuRef}>
          <AccountMenu
            open={accountMenuOpen}
            loggingOut={loggingOut}
            user={currentUser}
            onToggle={() => setAccountMenuOpen((current) => !current)}
            onSettings={() => router.push("/admin/users")}
            onLogout={handleLogout}
          />
        </div>
      </header>

      <section className="workbench">
        <aside
          className={`workspace-rail ${sidebarCollapsed ? "workspace-rail-collapsed" : ""}`}
          aria-label="历史会话"
        >
          <button
            className="rail-collapse-button"
            type="button"
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            <svg aria-hidden="true" width="36" height="36" viewBox="0 0 36 36" fill="none">
              <rect x="1" y="1" width="34" height="34" rx="17" fill="white" />
              <rect x="1" y="1" width="34" height="34" rx="17" stroke="#D8E5DE" strokeWidth="2" />
              <path
                d="M20.25 12.75L15 18L20.25 23.25"
                stroke="#16846D"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {sidebarCollapsed ? (
            <div className="collapsed-rail-mark" aria-hidden="true">作</div>
          ) : (
            <div className="conversation-history">
              <div className="history-heading">
                <span className="rail-label">创作记录</span>
                <button type="button" onClick={startNewConversation} title="新建创作" aria-label="新建创作">＋</button>
              </div>
              <div className="conversation-list">
                {conversations.map((conversation) => (
                  <article
                    key={conversation.id}
                    className={conversation.id === conversationId ? "active" : ""}
                  >
                    <button className="conversation-open" type="button" onClick={() => void openConversation(conversation.id)}>
                      <strong>{conversation.title}</strong>
                      <time>{formatConversationTime(conversation.lastInteractionAt)}</time>
                    </button>
                    <button
                      className="conversation-delete"
                      type="button"
                      onClick={() => void removeConversation(conversation.id)}
                      title="删除会话"
                      aria-label={`删除 ${conversation.title}`}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}
        </aside>

        <section className="creation-area">
          <div className="hero-copy">
            <span className="eyebrow">{conversationId ? "历史创作" : "新的创作"}</span>
            <h1>今天想写什么？</h1>
            <p>告诉 AI 你的创作目的、读者和素材。系统会自动拆解任务，并生成适合手机阅读的公众号内容。</p>
          </div>

          <section className="chat-panel" aria-labelledby="chat-title">
            <div className="chat-header">
              <div>
                <span className="eyebrow">当前创作</span>
                <h2 id="chat-title">对话式创作</h2>
              </div>
              <span className="context-pill">当前对话上下文</span>
            </div>

            <div className="message-list" ref={messageListRef}>
              <MessageList
                messages={chat.messages}
                resourcesById={resourcesById}
                onClarificationSubmit={handleClarificationSubmit}
              />
            </div>

            {assets.length > 0 && (
              <div className="asset-row" aria-label="已添加素材">
                <ResourceThumbnails
                  resourceIds={assets.map((asset) => asset.id)}
                  resourcesById={resourcesById}
                  removable
                  onRemove={(resourceId) => void removeAsset(resourceId)}
                />
              </div>
            )}

            <div className="chat-composer">
              <textarea
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                onPaste={(event) => void handlePaste(event)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    void handleGenerate();
                  }
                }}
                placeholder="输入你的公众号创作需求，可以包含主题、读者、篇幅、风格、素材说明。"
                rows={4}
                maxLength={800}
              />
              <div className="composer-actions">
                <button className="resource-action upload-action" type="button" onClick={() => assetInputRef.current?.click()}>
                  上传资料
                </button>
                <label className="inline-select">
                  <span>@ Skill</span>
                  <select
                    value={layoutSkill}
                    onChange={(event) => setLayoutSkill(event.target.value as BuiltInLayoutSkillId)}
                    aria-label="选择 Skill"
                  >
                    <option value="auto">智能匹配</option>
                    <option value="youth-growth-listicle">少儿成长清单</option>
                  </select>
                </label>
                <span className="paste-hint">支持粘贴图片、文档或网页链接作为素材</span>
                <button
                  className="send-button"
                  type="button"
                  onClick={handleGenerate}
                  disabled={busy}
                  title="发送"
                  aria-label="发送"
                >
                  {busy ? "..." : "➜"}
                </button>
              </div>
              <input
                ref={assetInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                onChange={handleAssetSelection}
              />
            </div>
          </section>
        </section>

        <section className="panel preview-panel">
          <div className="preview-toolbar">
            <span className="phone-label">手机预览</span>
            <div className="segmented" aria-label="预览模式">
              <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}>预览</button>
              <button className={mode === "source" ? "active" : ""} onClick={() => setMode("source")}>源码</button>
            </div>
            <button className="copy-button" type="button" onClick={handleCopy}>复制 HTML</button>
          </div>

          <div className={mode === "preview" ? "phone" : "source-view"}>
            {mode === "preview" ? (
              <iframe title="公众号文章预览" srcDoc={html} sandbox="" />
            ) : (
              <textarea readOnly value={html} aria-label="微信公众号 HTML 源码" />
            )}
          </div>

          <footer className="compatibility">
            <span>{result ? `Renderer ${result.render.rendererVersion}` : "等待生成"}</span>
            <span className={warningCount ? "warning" : ""}>
              {warningCount ? `${warningCount} 项兼容提示` : "微信兼容检查"}
            </span>
          </footer>
        </section>
      </section>
    </main>
  );
}
