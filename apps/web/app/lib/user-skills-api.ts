import type {
  ImportUserSkillRequest,
  ImportUserSkillResponse,
  ListUserSkillsResponse,
  UserSkillAsset,
  UserSkillDetail
} from "@mediaforge/contracts";
import { serviceFetch } from "./api-client";

async function readResponse<TBody>(response: Response, fallbackMessage: string): Promise<TBody> {
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? fallbackMessage);
  }
  return response.json() as Promise<TBody>;
}

export async function listUserSkills(): Promise<ListUserSkillsResponse> {
  return readResponse(await serviceFetch("/user-skills", { cache: "no-store" }), "Skill 列表读取失败");
}

export async function importUserSkill(input: ImportUserSkillRequest): Promise<ImportUserSkillResponse> {
  return readResponse(await serviceFetch("/user-skills/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  }), "Skill 导入失败");
}

export async function disableUserSkill(skillId: string): Promise<UserSkillDetail> {
  return readResponse(await serviceFetch(`/user-skills/${skillId}/disable`, {
    method: "POST"
  }), "Skill 停用失败");
}

export async function uploadUserSkillAsset(
  skillId: string,
  versionId: string,
  assetKey: string,
  file: File
): Promise<UserSkillAsset> {
  return readResponse(await serviceFetch(`/user-skills/${skillId}/versions/${versionId}/assets/${assetKey}`, {
    method: "POST",
    headers: {
      "content-type": file.type,
      "x-file-name": encodeURIComponent(file.name || assetKey)
    },
    body: file
  }), "Skill 资源上传失败");
}
