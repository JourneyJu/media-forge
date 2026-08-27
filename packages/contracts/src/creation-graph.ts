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
  "presentation_style_decision",
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

export const contentIdentitySchema = z.object({
  topicSummary: z.string().trim().min(1).max(300),
  namedEntities: z.array(z.string().trim().min(1).max(120)).max(30),
  requiredFacts: z.array(z.string().trim().min(1).max(300)).max(30),
  requiredClaims: z.array(z.string().trim().min(1).max(300)).max(20),
  mustIncludeVerbatim: z.array(z.string().trim().min(1).max(300)).max(20),
  prohibitedClaims: z.array(z.string().trim().min(1).max(300)).max(20)
});

export type ContentIdentity = z.infer<typeof contentIdentitySchema>;

export const creativeBriefSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  creativeTheme: z.string().trim().min(1).max(120).optional(),
  contentIdentity: contentIdentitySchema.optional(),
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
  sectionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(300),
  storyBeat: z.string().trim().min(1).max(300),
  commercialGoal: z.string().trim().min(1).max(300)
});

export type ArticleOutlineSection = z.infer<typeof articleOutlineSectionSchema>;

export const imageNarrativeRoleSchema = z.enum(["cover", "fact_proof", "scene", "emotion", "detail", "ending", "gallery"]);
export const imagePlacementSchema = z.enum(["cover", "section", "ending", "gallery"]);
export const imageVisualRoleSchema = z.enum(["scene", "people", "award", "detail", "emotion", "proof", "brand"]);

export const articleOutlineSchema = z.object({
  structureVersion: z.string().trim().min(1),
  title: z.string().trim().min(1).max(64),
  subtitle: z.string().trim().max(100).optional(),
  openingHook: z.string().trim().min(1).max(300),
  callToAction: z.string().trim().min(1).max(300),
  sections: z.array(articleOutlineSectionSchema).min(3).max(10),
  imageSlots: z.array(z.object({
    resourceId: z.string().trim().min(1),
    sectionIndex: z.number().int().min(0).max(9).optional(),
    placement: imagePlacementSchema,
    narrativePurpose: z.string().trim().min(1).max(300)
  })).max(20).optional()
});

export type ArticleOutline = z.infer<typeof articleOutlineSchema>;

export const contentPlanSchema = z.object({
  structureVersion: z.string().trim().min(1),
  angle: z.string().trim().min(1).max(300),
  narrative: z.string().trim().min(1).max(500),
  requirements: z.array(z.object({
    requirement: z.string().trim().min(1).max(300),
    evidence: z.string().trim().min(1).max(300)
  })).max(20),
  sections: z.array(z.object({
    sectionId: z.string().trim().min(1),
    heading: z.string().trim().min(1).max(100),
    purpose: z.string().trim().min(1).max(300),
    keyPoints: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
    assetRefs: z.array(z.string().trim().min(1)).max(10),
    candidateImageRefs: z.array(z.object({
      resourceId: z.string().trim().min(1),
      reason: z.string().trim().min(1).max(300),
      role: imageNarrativeRoleSchema
    })).max(10).optional()
  })).min(3).max(10),
  callToAction: z.string().trim().min(1).max(300)
});

export type ContentPlan = z.infer<typeof contentPlanSchema>;

export const contentPlanInputSchema = contentPlanSchema.omit({ structureVersion: true }).extend({
  sections: z.array(contentPlanSchema.shape.sections.element.omit({ sectionId: true })).min(3).max(10)
});

export type ContentPlanInput = z.infer<typeof contentPlanInputSchema>;

export const articleDraftSectionSchema = z.object({
  sectionId: z.string().trim().min(1),
  heading: z.string().trim().min(1).max(100),
  purpose: z.string().trim().min(1).max(300),
  paragraphs: z.array(z.string().trim().min(1).max(3000)).min(1).max(8),
  assetRefs: z.array(z.string().trim().min(1)).max(10),
  emphasis: z.string().trim().min(1).max(500).optional()
});

export const articleDraftSchema = z.object({
  structureVersion: z.string().trim().min(1),
  title: z.string().trim().min(1).max(64),
  subtitle: z.string().trim().max(100).optional(),
  intro: z.string().trim().min(1).max(3000),
  sections: z.array(articleDraftSectionSchema).min(3).max(10),
  conclusion: z.string().trim().min(1).max(3000),
  callToAction: z.string().trim().max(1000).optional()
});

export type ArticleDraft = z.infer<typeof articleDraftSchema>;

export const imagePlanItemSchema = z.object({
  placement: imagePlacementSchema,
  description: z.string().trim().min(1).max(500),
  resourceId: z.string().trim().min(1).optional(),
  assetKey: z.string().trim().min(1).optional(),
  sectionId: z.string().trim().min(1).optional(),
  sectionIndex: z.number().int().min(0).max(9).optional(),
  visualRole: imageVisualRoleSchema.optional(),
  matchReason: z.string().trim().min(1).max(500).optional(),
  confidence: z.number().min(0).max(1).optional(),
  captionHint: z.string().trim().min(1).max(200).optional()
});

export const imagePlanSchema = z.object({
  structureVersion: z.string().trim().min(1),
  items: z.array(imagePlanItemSchema).max(20)
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
    quality: z.enum(["high", "medium", "low"]).optional(),
    subjects: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    scene: z.string().trim().max(200).optional(),
    actions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    mood: z.string().trim().max(100).optional(),
    visualTags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    suggestedRoles: z.array(imageNarrativeRoleSchema).max(10).optional(),
    riskNotes: z.array(z.string().trim().min(1).max(200)).max(10).optional()
  })).max(50)
});

export type MaterialAnalysis = z.infer<typeof materialAnalysisSchema>;

export const presentationSourceSchema = z.enum(["user", "content", "skill", "mixed"]);

export const userPresentationConstraintsSchema = z.object({
  rawFragments: z.array(z.string().trim().min(1).max(300)).max(20),
  requestedColors: z.array(z.string().trim().min(1).max(40)).max(12),
  prohibitedColors: z.array(z.string().trim().min(1).max(40)).max(12),
  colorUsage: z.array(z.string().trim().min(1).max(200)).max(12),
  decorationRequirements: z.array(z.string().trim().min(1).max(200)).max(12),
  imageRequirements: z.array(z.string().trim().min(1).max(200)).max(12),
  brandRequirements: z.array(z.string().trim().min(1).max(200)).max(12)
}).strict();

export type UserPresentationConstraints = z.infer<typeof userPresentationConstraintsSchema>;

export const presentationStyleDecisionSchema = z.object({
  schemaVersion: z.literal("presentation-style-v1"),
  structureVersion: z.string().trim().min(1),
  source: presentationSourceSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.string().trim().min(1).max(500),
  visual: z.object({
    theme: z.enum([
      "editorial",
      "warm-story",
      "stage-celebration",
      "professional-report",
      "practical-guide",
      "brand-campaign",
      "minimal-documentary"
    ]),
    hierarchy: z.enum(["title-led", "balanced", "section-led", "image-led"]),
    typography: z.enum(["sans", "serif", "mixed"]),
    density: z.enum(["compact", "balanced", "comfortable"]),
    alignment: z.enum(["left", "center", "mixed"]),
    whitespace: z.enum(["tight", "balanced", "generous"]),
    sectionRhythm: z.enum(["numbered", "labelled", "timeline", "minimal", "carded"])
  }).strict(),
  colorDecoration: z.object({
    colorSource: presentationSourceSchema,
    requestedColors: z.array(z.string().trim().min(1).max(40)).max(12),
    prohibitedColors: z.array(z.string().trim().min(1).max(40)).max(12),
    paletteIntent: z.object({
      primary: z.string().trim().min(1).max(40),
      accent: z.string().trim().min(1).max(40),
      text: z.string().trim().min(1).max(40),
      surface: z.string().trim().min(1).max(40)
    }).strict(),
    brightness: z.enum(["dark", "balanced", "light"]),
    saturation: z.enum(["low", "medium", "high"]),
    contrast: z.enum(["low", "medium", "high"]),
    surfaceTreatment: z.enum(["none", "card", "border", "tinted"]),
    dividerTreatment: z.enum(["whitespace", "thin-line", "bold-line", "dotted", "graphic"]),
    sectionMarker: z.enum(["none", "number", "label", "dot", "timeline"]),
    ornamentLevel: z.enum(["minimal", "moderate", "rich"])
  }).strict(),
  imagePresentation: z.object({
    heroStrategy: z.enum(["full-width", "framed", "after-title", "after-intro", "none"]),
    sizeStrategy: z.enum(["full-width", "medium", "small", "narrative-role"]),
    aspectPolicy: z.enum(["preserve", "subject-first-crop", "no-crop"]),
    grouping: z.enum(["single", "paired", "gallery", "continuous", "text-image-alternating"]),
    frameTreatment: z.enum(["none", "thin-border", "matte", "rounded"]),
    captionPolicy: z.enum(["none", "short", "fact", "person"]),
    rhythm: z.enum(["one-per-section", "focus-sections", "even", "opening-heavy"])
  }).strict(),
  brandPresentation: z.object({
    prominence: z.enum(["hidden", "light", "standard", "strong"]),
    logoPlacement: z.enum(["none", "header", "ending", "brand-module"]),
    fixedModules: z.array(z.string().trim().min(1).max(80)).max(20),
    brandAssets: z.array(z.string().trim().min(1).max(80)).max(20),
    ctaStyle: z.enum(["none", "follow", "consult", "register", "purchase", "visit"]),
    qrcodePlacement: z.enum(["none", "cta", "ending"]),
    constraints: z.array(z.string().trim().min(1).max(200)).max(20)
  }).strict()
}).strict();

export type PresentationStyleDecision = z.infer<typeof presentationStyleDecisionSchema>;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const layoutPlanSchema = z.object({
  structureVersion: z.string().trim().min(1),
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
    sectionId: z.string().trim().min(1).optional(),
    assetRef: z.string().trim().min(1).optional()
  })).min(2).max(40)
});

export type LayoutPlan = z.infer<typeof layoutPlanSchema>;

export const reviewIssueSchema = z.object({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(["warning", "error"]),
  target: z.enum(["brief", "plan", "title", "outline", "body", "image", "presentation", "layout", "cta"]),
  instruction: z.string().trim().min(1).max(500)
});

export const contentCoverageItemSchema = z.object({
  kind: z.enum(["entity", "fact", "claim", "verbatim"]),
  requirement: z.string().trim().min(1).max(300),
  status: z.enum(["covered", "missing", "contradicted", "uncertain"]),
  evidence: z.string().trim().min(1).max(500).optional(),
  confidence: z.number().min(0).max(1)
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
  issues: z.array(reviewIssueSchema).max(30),
  contentCoverage: z.array(contentCoverageItemSchema).max(100).optional()
});

export const artifactValidationResultSchema = z.object({
  passed: z.boolean(),
  violations: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(300)
  })).max(30),
  diagnostics: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(300)
  })).max(30).optional()
});

export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ContentCoverageItem = z.infer<typeof contentCoverageItemSchema>;
export type ReviewReport = z.infer<typeof reviewReportSchema>;
export type ArtifactValidationResult = z.infer<typeof artifactValidationResultSchema>;

export const qualityStatusSchema = z.enum(["passed", "warning"]);
export const completionReasonSchema = z.enum(["review_passed", "max_revision_reached"]);

export type QualityStatus = z.infer<typeof qualityStatusSchema>;
export type CompletionReason = z.infer<typeof completionReasonSchema>;

export const creationSnapshotSchema = z.object({
  materials: materialAnalysisSchema,
  brief: creativeBriefSchema,
  contentPlan: contentPlanSchema,
  titles: titleCandidatesSchema,
  outline: articleOutlineSchema,
  draft: articleDraftSchema,
  imagePlan: imagePlanSchema,
  presentationStyleDecision: presentationStyleDecisionSchema,
  layoutPlan: layoutPlanSchema
});

export type CreationSnapshot = z.infer<typeof creationSnapshotSchema>;

export const conversationMaterialSummarySchema = z.object({
  resourceId: z.string().trim().min(1),
  type: z.enum(["image", "document", "link", "unknown"]),
  description: z.string().trim().min(1).max(1000),
  ocrText: z.string().trim().max(4000).optional(),
  suggestedUsage: z.string().trim().max(500).optional(),
  quality: z.enum(["high", "medium", "low"]).optional(),
  subjects: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  scene: z.string().trim().max(200).optional(),
  actions: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
  mood: z.string().trim().max(100).optional(),
  visualTags: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  suggestedRoles: z.array(imageNarrativeRoleSchema).max(10).optional(),
  riskNotes: z.array(z.string().trim().min(1).max(200)).max(10).optional()
});

export const conversationInstructionMemorySchema = z.object({
  rebuiltContext: z.object({
    taskGoal: z.string().trim().max(300).optional(),
    sourceRequest: z.string().trim().max(2000).optional(),
    audience: z.string().trim().max(200).optional(),
    styleConstraints: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    contentRequirements: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
    prohibitedContent: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    unresolvedQuestions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    confidence: z.enum(["high", "medium", "low"]).default("medium")
  }).optional(),
  recentValuableTurns: z.array(z.object({
    messageId: z.string().trim().min(1),
    content: z.string().trim().min(1).max(4000),
    reason: z.string().trim().min(1).max(200)
  })).max(2).default([])
}).default({
  recentValuableTurns: []
});

export const conversationResourceContextSchema = z.object({
  currentResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  inheritedResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  artifactResourceIds: z.array(z.string().trim().min(1)).max(50).default([]),
  materialSummary: z.array(conversationMaterialSummarySchema.extend({
    originalName: z.string().trim().max(300).optional(),
    contentType: z.string().trim().max(120).optional(),
    sourceMessageId: z.string().trim().min(1).optional()
  })).max(50).default([])
}).default({
  currentResourceIds: [],
  inheritedResourceIds: [],
  artifactResourceIds: [],
  materialSummary: []
});

export const creationOperationSchema = z.enum(["new", "revise", "continue", "clarify"]);
export const creationDecisionSourceSchema = z.enum(["user", "rule", "model"]);
export const creationMutationScopeSchema = z.enum(["content", "title", "structure", "images", "presentation"]);
export const creationRequestProvenanceSchema = z.object({
  field: z.string().trim().min(1).max(160),
  source: z.enum(["current_turn", "working_memory", "artifact", "resource"]),
  sourceId: z.string().trim().min(1).max(160)
});

export const resolvedCreationRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: creationOperationSchema,
  decisionSource: creationDecisionSourceSchema,
  confidence: z.enum(["high", "medium", "low"]),
  currentInstruction: z.string().trim().min(1).max(4000),
  baseArtifactId: z.string().trim().min(1).optional(),
  mutationScope: z.array(creationMutationScopeSchema).max(5).default([]),
  inheritance: z.object({
    content: z.enum(["replace", "preserve", "extend"]),
    presentation: z.enum(["replace", "preserve"]),
    resources: z.enum(["current_only", "explicit", "artifact_used"])
  }),
  contentIdentity: contentIdentitySchema,
  provenance: z.array(creationRequestProvenanceSchema).max(100).default([]),
  clarification: z.object({
    reasonCode: z.string().trim().min(1).max(80),
    question: z.string().trim().min(1).max(500)
  }).optional()
}).superRefine((value, context) => {
  if (value.operation === "new" && value.baseArtifactId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseArtifactId"],
      message: "new 请求不得引用历史 Artifact"
    });
  }
  if (value.operation === "new" && value.inheritance.content !== "replace") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inheritance", "content"],
      message: "new 请求必须替换历史内容"
    });
  }
  if (value.operation === "revise" && !value.baseArtifactId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["baseArtifactId"],
      message: "revise 请求必须引用基准 Artifact"
    });
  }
  if (value.operation === "revise" && value.mutationScope.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mutationScope"],
      message: "revise 请求必须声明修改范围"
    });
  }
  if (value.operation === "clarify" && !value.clarification) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clarification"],
      message: "clarify 请求必须包含澄清问题"
    });
  }
  const provenanceKeys = value.provenance.map((item) => `${item.field}:${item.sourceId}`);
  if (new Set(provenanceKeys).size !== provenanceKeys.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["provenance"],
      message: "同一字段和来源不得重复"
    });
  }
});

export const creationFailureEnvelopeSchema = z.object({
  code: z.string().trim().min(1).max(80),
  stage: z.string().trim().min(1).max(80),
  category: z.enum(["integrity", "quality", "provider", "system"]),
  recoverability: z.enum(["retry_same", "revise_input", "clarify", "none"]),
  summary: z.string().trim().min(1).max(500),
  violations: z.array(z.object({
    code: z.string().trim().min(1).max(80),
    target: z.string().trim().min(1).max(80),
    evidence: z.string().trim().min(1).max(500).optional()
  })).max(30).default([])
});

export type CreationOperation = z.infer<typeof creationOperationSchema>;
export type CreationDecisionSource = z.infer<typeof creationDecisionSourceSchema>;
export type CreationMutationScope = z.infer<typeof creationMutationScopeSchema>;
export type CreationRequestProvenance = z.infer<typeof creationRequestProvenanceSchema>;
export type ResolvedCreationRequest = z.infer<typeof resolvedCreationRequestSchema>;
export type CreationFailureEnvelope = z.infer<typeof creationFailureEnvelopeSchema>;

export const conversationWorkingMemorySchema = z.object({
  conversationId: z.string().trim().min(1),
  contextVersion: z.number().int().min(0),
  instructionMemory: conversationInstructionMemorySchema,
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
  presentationStyleDecision: presentationStyleDecisionSchema.optional(),
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
  resourceContext: conversationResourceContextSchema,
  materialSummary: z.array(conversationMaterialSummarySchema).max(50).default([]),
  userConstraints: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  revisionIntent: z.object({
    target: z.enum(["title", "outline", "body", "image", "style", "all"]).optional(),
    instruction: z.string().trim().min(1).max(1000),
    createdAt: z.string().trim().min(1)
  }).optional(),
  successfulBaseline: z.object({
    artifactId: z.string().trim().min(1),
    contentIdentity: contentIdentitySchema,
    contentHash: z.string().trim().min(1).max(128).optional(),
    sectionIds: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    imageSemanticRefs: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
    updatedAt: z.string().trim().min(1)
  }).optional(),
  lastAttempt: z.object({
    runId: z.string().trim().min(1),
    operation: creationOperationSchema,
    mutationScope: z.array(creationMutationScopeSchema).max(5).default([]),
    status: z.enum(["completed", "failed", "cancelled"]),
    resolvedRequest: resolvedCreationRequestSchema.optional(),
    failure: creationFailureEnvelopeSchema.optional(),
    updatedAt: z.string().trim().min(1)
  }).optional(),
  lastArtifactId: z.string().trim().min(1).optional(),
  updatedAt: z.string().trim().min(1)
});

export type ConversationMaterialSummary = z.infer<typeof conversationMaterialSummarySchema>;
export type ConversationInstructionMemory = z.infer<typeof conversationInstructionMemorySchema>;
export type ConversationResourceContext = z.infer<typeof conversationResourceContextSchema>;
export type ConversationWorkingMemory = z.infer<typeof conversationWorkingMemorySchema>;

export const intentResolutionSchema = z.object({
  mode: z.enum(["new", "revise", "continue", "clarify"]),
  sameTopic: z.boolean(),
  confidence: z.enum(["high", "medium", "low"]),
  effectiveInstruction: z.string().trim().min(1).max(8000),
  inheritedMessageIds: z.array(z.string().trim().min(1)).max(20),
  reason: z.string().trim().min(1).max(500)
});

export type IntentResolution = z.infer<typeof intentResolutionSchema>;

export const creationRunContextMemorySchema = conversationWorkingMemorySchema.pick({
  instructionMemory: true,
  resourceContext: true,
  brief: true,
  selectedTitle: true,
  outline: true,
  presentationStyleDecision: true,
  layoutPlan: true,
  draftSummary: true,
  materialSummary: true,
  userConstraints: true,
  revisionIntent: true,
  successfulBaseline: true,
  lastAttempt: true,
  lastArtifactId: true
});

export const creationRunContextSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  userInput: z.string().trim().min(1),
  resourceIds: z.array(z.string().trim().min(1)).max(100),
  currentInstruction: z.string().trim().min(1).optional(),
  intentResolution: intentResolutionSchema.optional(),
  resolvedRequest: resolvedCreationRequestSchema.optional(),
  baseSnapshot: creationSnapshotSchema.optional(),
  creationMode: creationModeSchema.exclude(["auto"]).default("new"),
  currentResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  inheritedResourceIds: z.array(z.string().trim().min(1)).max(30).default([]),
  resourceContext: conversationResourceContextSchema,
  skillId: z.string().trim().min(1),
  selectedSkills: z.array(resolvedUserSkillSchema).max(1).default([]),
  maxSteps: z.number().int().min(1).max(100),
  contextVersion: z.number().int().min(1).optional(),
  memory: creationRunContextMemorySchema.default({
    instructionMemory: {
      recentValuableTurns: []
    },
    resourceContext: {
      currentResourceIds: [],
      inheritedResourceIds: [],
      artifactResourceIds: [],
      materialSummary: []
    },
    materialSummary: [],
    userConstraints: []
  })
}).superRefine((value, context) => {
  if (value.schemaVersion === 2 && !value.resolvedRequest) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["resolvedRequest"],
      message: "V2 RunContext 必须包含 ResolvedCreationRequest"
    });
  }
  if (value.resolvedRequest && value.currentInstruction !== value.resolvedRequest.currentInstruction) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["currentInstruction"],
      message: "RunContext 与 ResolvedCreationRequest 的本轮指令必须一致"
    });
  }
});

export type CreationRunContext = z.infer<typeof creationRunContextSchema>;

export interface CreationGraphState {
  workspaceId: string;
  conversationId: string;
  runId: string;
  userInput: string;
  intentResolution?: IntentResolution;
  resolvedRequest?: ResolvedCreationRequest;
  baseSnapshot?: CreationSnapshot;
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
  userPresentationConstraints?: UserPresentationConstraints;
  presentationStyleDecision?: PresentationStyleDecision;
  layoutPlan?: LayoutPlan;
  reviewReports: ReviewReport[];
  artifactValidation?: ArtifactValidationResult;
  finalDocument?: ArticleDocument;
  artifactId?: string;
  qualityStatus?: QualityStatus;
  completionReason?: CompletionReason;
  unresolvedIssues?: ReviewReport["issues"];
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
