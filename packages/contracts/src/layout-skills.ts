import type { Id } from "./common";
import type { WorkspaceIndustry, WorkspaceScenario } from "./workspaces";

export interface LayoutSkillPackSummary {
  id: Id;
  name: string;
  industry: WorkspaceIndustry;
  scenario: WorkspaceScenario;
  version: string;
  rendererKey: string;
  status: "active" | "disabled";
}

export interface LayoutSkillPackDefinition {
  id: Id;
  name: string;
  industry: WorkspaceIndustry;
  scenario: WorkspaceScenario;
  version: string;
  style: {
    tone: string;
    primaryColor: string;
    paragraphLength: "short" | "medium" | "long";
    visualDensity: "low" | "medium" | "high";
  };
  layoutRules: string[];
  modules: string[];
  wechatHtmlRenderer: string;
  promptTemplateKey: string;
}

export const builtInLayoutSkillIds = ["auto", "youth-growth-listicle"] as const;

export type BuiltInLayoutSkillId = (typeof builtInLayoutSkillIds)[number];

export const youthGrowthListicleSkill: LayoutSkillPackDefinition = {
  id: "youth-growth-listicle",
  name: "少儿成长清单",
  industry: "training",
  scenario: "course_intro",
  version: "1.0.0",
  style: {
    tone: "亲切、明快、积极，兼顾家长阅读时的可信度",
    primaryColor: "#67b95c",
    paragraphLength: "medium",
    visualDensity: "medium"
  },
  layoutRules: [
    "首段作为居中的柔和引言，不重复标题",
    "首图采用高识别度强调色边框",
    "正文以两位数序号形成稳定阅读锚点",
    "图片在每两个内容单元后穿插，避免连续堆图",
    "结尾使用简短总结，不输出模型计划、审阅过程或占位说明"
  ],
  modules: [
    "brand-kicker",
    "title",
    "intro-panel",
    "bordered-hero",
    "brand-divider",
    "numbered-section",
    "full-width-image",
    "closing-note"
  ],
  wechatHtmlRenderer: "youth-growth-listicle@1",
  promptTemplateKey: "wechat/youth-growth-listicle@1"
};
