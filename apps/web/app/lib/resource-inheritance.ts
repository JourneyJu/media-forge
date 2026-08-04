import type { ChatMessage, CreationMode, ResourceSummary } from "@mediaforge/contracts";

export function collectInheritedImageResourceIds(
  messages: ChatMessage[],
  resourcesById: Record<string, ResourceSummary>,
  currentResourceIds: string[],
  creationMode: CreationMode,
  limit = 30
): string[] {
  if (creationMode === "new") return [];

  const current = new Set(currentResourceIds);
  const inherited: string[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.type !== "user") continue;
    for (const resourceId of message.resourceIds) {
      if (current.has(resourceId) || seen.has(resourceId)) continue;
      const resource = resourcesById[resourceId];
      if (!resource?.contentType.startsWith("image/")) continue;
      inherited.push(resourceId);
      seen.add(resourceId);
      if (inherited.length >= limit) return inherited;
    }
  }

  return inherited;
}
