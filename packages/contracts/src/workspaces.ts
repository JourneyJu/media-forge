import { z } from "zod";
import type { Id, IsoDateTime } from "./common";
import { idSchema, isoDateTimeSchema } from "./common";

export type WorkspaceIndustry = "training" | "store" | "beauty" | "food" | "retail" | "fitness" | "other";
export type WorkspaceScenario = "enrollment" | "promotion" | "course_intro" | "member" | "event" | "brand";
export type WorkspaceStatus = "active" | "archived";

export const workspaceIndustrySchema = z.enum(["training", "store", "beauty", "food", "retail", "fitness", "other"]);
export const workspaceScenarioSchema = z.enum(["enrollment", "promotion", "course_intro", "member", "event", "brand"]);
export const workspaceStatusSchema = z.enum(["active", "archived"]);

export const createWorkspaceRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  industry: workspaceIndustrySchema,
  scenario: workspaceScenarioSchema,
  audience: z.string().trim().max(500).default(""),
  brandProfile: z.string().trim().max(1000).default(""),
  stylePrompt: z.string().trim().max(1000).default(""),
  defaultModules: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  forbiddenWords: z.array(z.string().trim().min(1).max(40)).max(100).default([]),
  memoryEnabled: z.boolean().default(true)
});

export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

export interface WorkspaceSummary {
  id: Id;
  name: string;
  industry: WorkspaceIndustry;
  scenario: WorkspaceScenario;
  status: WorkspaceStatus;
  articleCount: number;
  updatedAt: IsoDateTime;
}

export interface WorkspaceProfile {
  id: Id;
  name: string;
  industry: WorkspaceIndustry;
  scenario: WorkspaceScenario;
  audience: string;
  brandProfile: string;
  stylePrompt: string;
  defaultModules: string[];
  forbiddenWords: string[];
  memoryEnabled: boolean;
}

export const workspaceProfileSchema = z.object({
  id: idSchema,
  name: z.string(),
  industry: workspaceIndustrySchema,
  scenario: workspaceScenarioSchema,
  audience: z.string(),
  brandProfile: z.string(),
  stylePrompt: z.string(),
  defaultModules: z.array(z.string()),
  forbiddenWords: z.array(z.string()),
  memoryEnabled: z.boolean()
}) satisfies z.ZodType<WorkspaceProfile>;

export const workspaceSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  industry: workspaceIndustrySchema,
  scenario: workspaceScenarioSchema,
  status: workspaceStatusSchema,
  articleCount: z.number().int().min(0),
  updatedAt: isoDateTimeSchema
}) satisfies z.ZodType<WorkspaceSummary>;
