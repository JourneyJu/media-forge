import type { AgentRun } from "@mediaforge/contracts";

interface AgentConsoleProps {
  run: AgentRun | null;
  busy: boolean;
  instruction: string;
  onInstructionChange: (value: string) => void;
  onApprove: () => void;
  onRevisePlan: () => void;
}

const stepLabels: Record<string, string> = {
  analyzing_assets: "素材理解",
  planning: "执行计划",
  layout: "排版骨架",
  expanding: "内容扩充",
  reviewing: "整体审阅",
  revising: "局部修订",
  restructuring: "结构重排",
  final_review: "最终审阅",
  rendering: "微信渲染"
};

export function AgentConsole({
  run,
  busy,
  instruction,
  onInstructionChange,
  onApprove,
  onRevisePlan
}: AgentConsoleProps) {
  return (
    <>
      <div className="agent-summary">
        <span className={`agent-status agent-status-${run?.status ?? "idle"}`}>
          {run ? (run.status === "waiting_user" ? "等待确认" : run.status === "completed" ? "已完成" : "执行中") : "待开始"}
        </span>
        <p>{run?.plan.strategy ?? "提交生成信息后，Agent 会先输出执行计划。"}</p>
      </div>

      {run && (
        <section className="agent-plan">
          <div className="agent-section-title">
            <span>PLAN</span>
            <strong>执行计划</strong>
          </div>
          <p className="agent-rationale">{run.plan.rationale}</p>
          <ol>
            {run.plan.tasks.map((task) => (
              <li className={`plan-${task.status}`} key={task.id}>
                <span>{task.status === "completed" ? "✓" : task.status === "running" ? "•" : ""}</span>
                <div>
                  <strong>{task.title}</strong>
                  <small>{task.objective}</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="conversation agent-timeline">
        {!run && (
          <div className="assistant-message">
            <span>公众号 Agent</span>
            <p>我会先理解素材并制定计划，经你确认后再完成排版、扩充和审阅循环。</p>
          </div>
        )}
        {run?.steps.map((step) => (
          <article className={`agent-step step-${step.status}`} key={step.id}>
            <div className="step-marker">{String(step.stepNo).padStart(2, "0")}</div>
            <div>
              <span>{stepLabels[step.type] ?? step.type}</span>
              <strong>{step.title}</strong>
              <p>{step.summary}</p>
              {step.score !== undefined && <small>审阅评分 {step.score}</small>}
            </div>
          </article>
        ))}
      </div>

      {run?.waitingFor && (
        <section className="decision-panel">
          <strong>{run.waitingFor.prompt}</strong>
          <div>
            <button type="button" onClick={onApprove} disabled={busy}>按计划执行</button>
            <button className="secondary-action" type="button" onClick={onRevisePlan} disabled={busy || !instruction.trim()}>
              修改计划
            </button>
          </div>
        </section>
      )}

      <div className="composer">
        <textarea
          value={instruction}
          onChange={(event) => onInstructionChange(event.target.value)}
          placeholder={run?.status === "waiting_user" ? "补充计划要求，例如：更像成长画册，减少营销感" : "补充你的要求"}
          rows={4}
        />
        <small>{run ? `当前步骤：${stepLabels[run.currentStep] ?? run.currentStep}` : "Agent 尚未创建"}</small>
      </div>
    </>
  );
}
