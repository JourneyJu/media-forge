import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateStructuredJsonWithGateway, readModelGatewayConfig } from "./model-gateway";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

const config = {
  provider: "openai_compatible",
  baseUrl: "https://model.example.com",
  apiKey: "secret",
  model: "test-model",
  timeoutMs: 5000
};

function completion(content: string): Response {
  return new Response(JSON.stringify({
    id: "request_1",
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("readModelGatewayConfig", () => {
  it("stays in local demo mode when credentials are incomplete", () => {
    delete process.env.MODEL_GATEWAY_BASE_URL;
    delete process.env.MODEL_GATEWAY_API_KEY;
    delete process.env.MODEL_GATEWAY_DEFAULT_MODEL;

    expect(readModelGatewayConfig()).toBeNull();
  });

  it("ignores legacy model environment variables", () => {
    process.env.MODEL_GATEWAY_BASE_URL = "https://gateway.example.com/v1/";
    process.env.MODEL_GATEWAY_API_KEY = "test-secret";
    process.env.MODEL_GATEWAY_DEFAULT_MODEL = "example-model";

    expect(readModelGatewayConfig()).toBeNull();
  });
});

describe("generateStructuredJsonWithGateway", () => {
  it("includes the output contract in the system prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(completion('{"items":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    await generateStructuredJsonWithGateway(config, {
      agentName: "MaterialAgent",
      systemPrompt: "Analyze materials.",
      outputContract: '{"items":[]}',
      input: { resourceIds: [] },
      schema: z.object({ items: z.array(z.string()) })
    });

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[0].content).toContain('输出契约：{"items":[]}');
  });

  it("retries once with validation details when JSON misses required fields", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completion("{}"))
      .mockResolvedValueOnce(completion('{"items":[]}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStructuredJsonWithGateway(config, {
      agentName: "MaterialAgent",
      systemPrompt: "Analyze materials.",
      outputContract: '{"items":[]}',
      input: { resourceIds: [] },
      schema: z.object({ items: z.array(z.string()) })
    });

    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retryRequest.messages.at(-1).content).toContain("items");
  });
});
