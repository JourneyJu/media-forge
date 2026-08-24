import { z } from "zod";

export const reasoningSummaryCandidateSchema = z.object({
  activity: z.enum(["analyze", "compare", "plan", "check", "revise"]),
  subjects: z.array(z.string().trim().min(1).max(40)).min(1).max(3)
}).strict();

export type ReasoningSummaryCandidate = z.infer<typeof reasoningSummaryCandidateSchema>;

const blockedReasoningPattern =
  /(system\s*prompt|developer\s*message|api[_\s-]*key|authorization|bearer\s+[a-z0-9._-]+|skill\s*manifest|系统提示词|开发者指令|完整\s*skill|忽略.{0,8}(?:指令|要求)|prompt\s*injection)/iu;
const sensitiveValuePattern =
  /(sk-[a-z0-9_-]{8,}|https?:\/\/|(?:[a-z]:\\|\/(?:home|users|etc|var)\/)|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b1[3-9]\d{9}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[0-9a-f]{8}-[0-9a-f-]{27,}\b|\b[a-z0-9+/_=-]{32,}\b)/iu;
const structuredContentPattern = /(```|[{}\[\]]|<(?:script|style|system|assistant)\b)/iu;

export function sanitizeReasoningExcerpt(value: string, maxChars = 1_500): string | null {
  const lines = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) =>
    blockedReasoningPattern.test(line)
    || sensitiveValuePattern.test(line)
    || structuredContentPattern.test(line)
  )) return null;
  const safe = lines
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(-maxChars);
  return safe.length >= 12 ? safe : null;
}

export function formatReasoningSummary(candidate: ReasoningSummaryCandidate): string {
  const subjects = candidate.subjects.join("、");
  const prefix: Record<ReasoningSummaryCandidate["activity"], string> = {
    analyze: "正在分析",
    compare: "正在比较",
    plan: "正在规划",
    check: "正在检查",
    revise: "正在调整"
  };
  return `${prefix[candidate.activity]}${subjects}。`.slice(0, 120);
}

export function isReasoningSummaryCandidateGrounded(
  candidate: ReasoningSummaryCandidate,
  excerpt: string
): boolean {
  const normalized = excerpt.toLocaleLowerCase();
  const completionClaim = /(已完成|已确定|已通过|最终决定|最终结论)/u;
  return candidate.subjects.every((subject) =>
    !completionClaim.test(subject)
    && normalized.includes(subject.toLocaleLowerCase())
  );
}

export interface ReasoningSummaryObserver {
  push(delta: string): void;
  cancel(): void;
}

export function createReasoningSummaryObserver(options: {
  enabled: boolean;
  minChars: number;
  minAgeMs?: number;
  minIntervalMs: number;
  secondSummaryAfterMs?: number;
  maxSummaries: number;
  summarize: (excerpt: string, signal: AbortSignal) => Promise<ReasoningSummaryCandidate>;
  publish: (candidate: ReasoningSummaryCandidate, revision: number) => Promise<void>;
}): ReasoningSummaryObserver {
  let buffer = "";
  let published = 0;
  let lastRequestedAt = 0;
  let inFlight = false;
  let dirty = false;
  let cancelled = false;
  let controller: AbortController | null = null;
  let timer: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  const schedule = (waitMs: number): void => {
    if (timer || cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      request();
    }, waitMs);
    timer.unref();
  };

  const request = (): void => {
    if (!options.enabled || cancelled || inFlight || published >= options.maxSummaries) return;
    const excerpt = sanitizeReasoningExcerpt(buffer);
    if (!excerpt || excerpt.length < options.minChars) return;
    const ageMs = Date.now() - startedAt;
    const waitMs = Math.max(
      0,
      (options.minAgeMs ?? 0) - ageMs,
      options.minIntervalMs - (Date.now() - lastRequestedAt),
      published > 0 ? (options.secondSummaryAfterMs ?? 0) - ageMs : 0
    );
    if (waitMs > 0) {
      schedule(waitMs);
      return;
    }
    inFlight = true;
    dirty = false;
    lastRequestedAt = Date.now();
    controller = new AbortController();
    void options.summarize(excerpt, controller.signal)
      .then(async (candidate) => {
        if (cancelled || !isReasoningSummaryCandidateGrounded(candidate, excerpt)) return;
        published += 1;
        await options.publish(candidate, published);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        controller = null;
        if (dirty) request();
      });
  };

  return {
    push(delta) {
      if (cancelled || !options.enabled) return;
      buffer = (buffer + delta).slice(-8_192);
      dirty = true;
      request();
    },
    cancel() {
      cancelled = true;
      buffer = "";
      dirty = false;
      if (timer) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
    }
  };
}
