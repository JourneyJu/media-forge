import { z } from "zod";
import type { ArticleDocument } from "./articles";
import { creationModeSchema } from "./conversations";
import { resolvedUserSkillSchema } from "./user-skills";

export const creationGraphStatusSchema = z.enum([
  "queued",
  "running",
  "waiting_clarification",
  "completed",
  "failed",
  "cancelled"
]);

export const agentTaskStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped"
]);

export const agentOutputTypeSchema = z.enum([
  "creative_brief",
  "material_summary",
  "content_plan",
  "clarification_request",
  "title_candidates",
  "article_outline",
  "article_draft",
  "image_plan",
  "layout_plan",
  "review_report",
  "artifact_validation",
  "render_result"
]);

export const creationRunJobSchema = z.object({
  runId: z.string().trim().min(1),
  conversationId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  contextVersion: z.number().int().min(1),
  graphName: z.literal("wechat_article_creation"),
  graphVersion: z.string().trim().min(1)
});

export type CreationGraphStatus = z.infer<typeof creationGraphStatusSchema>;
export type AgentTaskStatus = z.infer<typeof agentTaskStatusSchema>;
export type AgentOutputType = z.infer<typeof agentOutputTypeSchema>;
export type CreationRunJob = z.infer<typeof creationRunJobSchema>;

export const creativeBriefSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  goal: z.enum(["brand", "promotion", "event", "education", "story"]),
  audience: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(80),
  campaignObject: z.string().trim().max(120).optional(),
  tone: z.string().trim().min(1).max(40),
  storyAngle: z.string().trim().min(1).max(200),
  materialRequirements: z.array(z.string().trim().min(1).max(200)).max(20),
  resourceIds: z.array(z.string().trim().min(1)).max(30),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20),
  prohibitedContent: z.array(z.string().trim().min(1).max(200)).max(20),
  skillId: z.string().trim().min(1).max(80)
});

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;

export interface ClarificationQuestion {
  id: string;
  label: string;
  required: boolean;
  suggestions: string[];
}

export interface ClarificationRequest {
  reason: string;
  questions: ClarificationQuestion[];
}

export const titleCandidateSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1).max(64),
  subtitle: z.string().trim().max(100).optional(),
  angle: z.string().trim().min(1).max(100),
  audienceFit: z.number().min(0).max(100),
  brandFit: z.number().min(0).max(100),
  clickPotential: z.number().min(0).max(100),
  riskFlags: z.array(z.string().trim().min(1).max(100)).max(10)
});

export const titleCandidatesSchema = z.object({
  items: z.array(titleCandidateSchema).min(3).max(5),
  selectedId: z.string().trim().min(1),
  selectionReason: z.string().trim().min(1).max(300)
}).superRefine((value, context) => {
  if (!value.items.some((item) => item.id === value.selectedId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selectedId"],
      message: "selectedId 必须引用候选标题"
    });
  }
});

export type TitleCandidate = z.infer<typeof titleCandidateSchema>;
export type TitleCandidates = z.infer<typeof titleCandidatesSchema>;

export const articleOutlineSectionSchema = z.object({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(300),
  storyBeat: z.string().trim().min(1).max(300),
  commercialGoal: z.string().trim().min(1).max(300)
});

export type ArticleOutlineSection = z.infer<typeof articleOutlineSectionSchema>;

export const articleOutlineSchema = z.object({
  title: z.string().trim().min(1).max(64),
  subtitle: z.string().trim().max(100).optional(),
  openingHook: z.string().trim().min(1).max(300),
  callToAction: z.string().trim().min(1).max(300),
  sections: z.array(articleOutlineSectionSchema).min(3).max(10)
});

export type ArticleOutline = z.infer<typeof articleOutlineSchema>;

export const contentPlanSchema = z.object({
  angle: z.string().trim().min(1).max(300),
  narrative: z.string().trim().min(1).max(500),
  requirements: z.array(z.object({
    requirement: z.string().trim().min(1).max(300),
    evidence: z.string().trim().min(1).max(300)
  })).max(20),
  sections: z.array(z.object({
    heading: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(300),
    keyPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    assetRefs: z.array(z.string().trim().min(1)).max(10)
  })).min(3).max(10),
  callToAction: z.string().trim().min(1).max(300)
});

export type ContentPlan = z.infer<typeof contentPlanSchema>;

export const articleDraftSectionSchema = z.object({
  heading: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(300),
  paragraphs: z.array(z.string().trim().min(1).max(3000)).min(1).max(8),
  assetRefs: z.array(z.string().trim().min(1)).max(10),
  emphasis: z.string().trim().min(1).max(500).optional()
});

export const articleDraftSchema = z.object({
  title: z.string().trim().min(1).max(64),
  subtitle: z.string().trim().max(100).optional(),
  intro: z.string().trim().min(1).max(3000),
  sections: z.array(articleDraftSectionSchema).min(3).max(10),
  conclusion: z.string().trim().min(1).max(3000),
  callToAction: z.string().trim().max(1000).optional()
});

export type ArticleDraft = z.infer<typeof articleDraftSchema>;

export const imagePlanItemSchema = z.object({
  placement: z.enum(["cover", "section", "ending"]),
  description: z.string().trim().min(1).max(500),
  resourceId: z.string().trim().min(1).optional(),
  assetKey: z.string().trim().min(1).optional()
});

export const imagePlanSchema = z.object({
  items: z.array(imagePlanItemSchema).min(1).max(20)
});

export type ImagePlanItem = z.infer<typeof imagePlanItemSchema>;
export type ImagePlan = z.infer<typeof imagePlanSchema>;

export const materialAnalysisSchema = z.object({
  items: z.array(z.object({
    resourceId: z.string().trim().min(1),
    type: z.enum(["image", "document", "link", "unknown"]),
    description: z.string().trim().min(1).max(1000),
    ocrText: z.string().trim().max(4000).optional(),
    suggestedUsage: z.string().trim().max(500).optional(),
    quality: z.enum(["high", "medium", "low"]).optional()
  })).max(50)
});

export type MaterialAnalysis = z.infer<typeof materialAnalysisSchema>;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const layoutPlanSchema = z.object({
  theme: z.enum(["editorial", "celebration", "story", "report", "brand"]),
  palette: z.object({
    primary: hexColorSchema,
    accent: hexColorSchema,
    text: hexColorSchema,
    surface: hexColorSchema
  }),
  titleTreatment: z.enum(["centered", "left-editorial", "poster"]),
  introTreatment: z.enum(["plain", "quote", "highlight-panel"]),
  sectionTreatment: z.enum(["numbered", "labelled", "minimal", "timeline"]),
  imageTreatment: z.enum(["full-width", "framed", "gallery"]),
  blocks: z.array(z.object({
    kind: z.enum(["title", "intro", "section", "image", "quote", "brand", "cta"]),
    sectionIndex: z.number().int().min(0).max(9).optional(),
    assetRef: z.string().trim().min(1).optional()
  })).min(2).max(40)
});

export type LayoutPlan = z.infer<typeof layoutPlanSchema>;

export const reviewIssueSchema = z.object({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(["warning", "error"]),
  target: z.enum(["brief", "plan", "title", "outline", "body", "image", "layout", "cta"]),
  instruction: z.string().trim().min(1).max(500)
});

export const reviewReportSchema = z.object({
  passed: z.boolean(),
  scores: z.object({
    story: z.number().min(0).max(100),
    commercial: z.number().min(0).max(100),
    audienceFit: z.number().min(0).max(100),
    naturalness: z.number().min(0).max(100),
    wechatReadability: z.number().min(0).max(100),
    factualRisk: z.number().min(0).max(100),
    subjectAlignment: z.number().min(0).max(100),
    requirementCoverage: z.number().min(0).max(100),
    contentDepth: z.number().min(0).max(100),
    layoutFit: z.number().min(0).max(100)
  }),
  issues: z.array(reviewIssueSchema).max(30)
});

export const artifactValidationResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(300)
  })).max(30)
});

export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type ArtifactValidationResult = z.infer<typeof artifactValidationResultSchema>;

export const conversationMaterialSummarySchema = z.object({
  resourceId: z.string().trim().min(1),
  type: z.enum(["image", "document", "link", "unknown"]),
  description: z.string().trim().min(1).max(1000),
  ocrText: z.string().trim().max(4000).optional(),
  suggestedUsage: z.string().trim().max(500).optional(),
  quality: z.enum(["high", "medium", "low"]).optional()
});

export const conversationWorkingMemorySchema = z.object({
  conversationId: z.string().trim().min(1),
  contextVersion: z.number().int().min(0),
  brief: creativeBriefSchema.optional(),
  selectedTitle: z.object({
    id: z.string().trim().min(1),
    title: z.string().trim().min(1).max(64),
    subtitle: z.string().trim().max(100).optional(),
    angle: z.string().trim().max(100).optional()
  }).optional(),
  outline: z.object({
    title: z.string().trim().min(1).max(64),
    subtitle: z.string().trim().max(100).optional(),
    sectionTitles: z.array(z.string().trim().min(1).max(100)).max(10),
    openingHook: z.string().trim().max(300).optional(),
    callToAction: z.string().trim().max(300).optional()
  }).optional(),
  layoutPlan: layoutPlanSchema.optional(),
  draftSummary: z.object({
    artifactId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(64),
    paragraphCount: z.number().int().min(0).max(100),
    sectionTitles: z.array(z.string().trim().min(1).max(100)).max(10),
    keyPoints: z.array(z.string().trim().min(1).max(300)).max(12),
    tone: z.string().trim().max(40).optional(),
    audience: z.string().trim().max(200).optional()
  }).optional(),
  materialSummary: z.array(conversationMaterialSummarySchema).max(50).default([]),
  userConstraints: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  revisionIntent: z.object({
    target: z.enum(["title", "outline", "body", "image", "style", "all"]).optional(),
    instruction: z.string().trim().min(1).max(1000),
    createdAt: z.string().trim().min(1)
  }).optional(),
  lastArtifactId: z.string().trim().min(1).optional(),
  updatedAt: z.string().trim().min(1)
});

export type ConversationMaterialSummary = z.infer<typeof conversationMaterialSummarySchema>;
export type ConversationWorkingMemory = z.infer<typeof conversationWorkingMemorySchema>;

export const creationRunContextMemorySchema = conversationWorkingMemorySchema.pick({
  brief: true,
  selectedTitle: true,
  outline: true,
  layoutPlan: true,
  draftSummary: true,
  materialSummary: true,
  userConstraints: true,
  revisionIntent: true,
  lastArtifactId: true
});

export const creationRunContextSchema = z.object({
  userInput: z.string().trim().min(1),
  resourceIds: z.array(z.string().trim().min(1)).max(100),
  currentInstruction: z.string().trim().min(1).optional(),
  creationMode: creationModeSchema.exclude(["auto"]).default("new"),
  currentResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  inheritedResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  skillId: z.string().trim().min(1),
  selectedSkills: z.array(resolvedUserSkillSchema).max(1).default([]),
  maxSteps: z.number().int().min(1).max(100),
  contextVersion: z.number().int().min(1).optional(),
  memory: creationRunContextMemorySchema.default({
    materialSummary: [],
    userConstraints: []
  })
});

export type CreationRunContext = z.infer<typeof creationRunContextSchema>;

export interface CreationGraphState {
  workspaceId: string;
  conversationId: string;
  runId: string;
  userInput: string;
  resourceIds: string[];
  skillId: string;
  selectedSkills: CreationRunContext["selectedSkills"];
  memory?: CreationRunContext["memory"];
  brief?: CreativeBrief;
  materials?: MaterialAnalysis;
  contentPlan?: ContentPlan;
  clarification?: ClarificationRequest;
  titles?: TitleCandidates;
  outline?: ArticleOutline;
  draft?: ArticleDraft;
  imagePlan?: ImagePlan;
  layoutPlan?: LayoutPlan;
  reviewReports: ReviewReport[];
  artifactValidation?: ArtifactValidationResult;
  finalDocument?: ArticleDocument;
  artifactId?: string;
  revisionCount: number;
  maxRevisionCount: number;
  status: CreationGraphStatus;
}

export interface AgentTask {
  id: string;
  runId: string;
  agentName: string;
  nodeName: string;
  status: AgentTaskStatus;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface AgentOutput {
  id: string;
  runId: string;
  agentTaskId: string;
  type: AgentOutputType;
  schemaVersion: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
