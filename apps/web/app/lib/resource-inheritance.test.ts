import { describe, expect, it } from "vitest";
import type { ChatMessage, ResourceSummary } from "@mediaforge/contracts";
import { collectInheritedImageResourceIds } from "./resource-inheritance";

function resource(id: string, contentType = "image/jpeg"): ResourceSummary {
  return {
    id,
    uploadSessionId: null,
    conversationId: "conversation_1",
    status: "attached",
    source: "upload",
    originalName: `${id}.jpg`,
    contentType,
    sizeBytes: 100,
    previewUrl: `/resources/${id}/preview`,
    contentUrl: `/resources/${id}/content`,
    createdAt: "2026-08-04T00:00:00.000Z"
  };
}

const messages: ChatMessage[] = [
  {
    id: "m1",
    type: "user",
    content: "first",
    resourceIds: ["image_1", "doc_1"],
    createdAt: "2026-08-04T00:00:00.000Z"
  },
  {
    id: "m2",
    type: "assistant",
    content: "ok",
    streaming: false,
    createdAt: "2026-08-04T00:00:01.000Z"
  },
  {
    id: "m3",
    type: "user",
    content: "continue",
    resourceIds: ["image_2", "image_1"],
    createdAt: "2026-08-04T00:00:02.000Z"
  }
];

describe("collectInheritedImageResourceIds", () => {
  it("collects historical user image resources for continued runs", () => {
    expect(collectInheritedImageResourceIds(messages, {
      image_1: resource("image_1"),
      image_2: resource("image_2"),
      doc_1: resource("doc_1", "application/pdf")
    }, [], "continue")).toEqual(["image_1", "image_2"]);
  });

  it("does not inherit resources for new creations", () => {
    expect(collectInheritedImageResourceIds(messages, {
      image_1: resource("image_1")
    }, [], "new")).toEqual([]);
  });

  it("excludes resources uploaded in the current turn", () => {
    expect(collectInheritedImageResourceIds(messages, {
      image_1: resource("image_1"),
      image_2: resource("image_2")
    }, ["image_1"], "auto")).toEqual(["image_2"]);
  });
});
