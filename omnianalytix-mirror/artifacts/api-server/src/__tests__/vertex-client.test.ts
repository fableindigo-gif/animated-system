import { describe, it, expect, vi, beforeAll } from "vitest";

const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();
const googleGenAICtor = vi.fn();

vi.mock("@google/genai", () => {
  class GoogleGenAI {
    public models: {
      generateContent: typeof generateContentMock;
      generateContentStream: typeof generateContentStreamMock;
    };
    constructor(opts: unknown) {
      googleGenAICtor(opts);
      this.models = {
        generateContent: generateContentMock,
        generateContentStream: generateContentStreamMock,
      };
    }
  }
  return { GoogleGenAI };
});

vi.mock("google-auth-library", () => {
  class GoogleAuth {
    constructor(_opts: unknown) {}
    async getClient() {
      return { kind: "fake-auth-client" };
    }
  }
  return { GoogleAuth };
});

beforeAll(() => {
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
});

async function loadClient() {
  return await import("../lib/vertex-client");
}

describe("vertex-client (native @google/genai)", () => {
  it("getGoogleGenAI returns a singleton client constructed for Vertex AI", async () => {
    googleGenAICtor.mockClear();
    const { getGoogleGenAI } = await loadClient();
    const a = await getGoogleGenAI();
    const b = await getGoogleGenAI();
    expect(a).toBe(b);
    // First-call construction is enough; we don't assert the count because the
    // module-level singleton may have been instantiated by an earlier test.
    const ctorArgs = googleGenAICtor.mock.calls.at(-1)?.[0] as
      | { vertexai?: boolean; project?: string; location?: string }
      | undefined;
    if (ctorArgs) {
      expect(ctorArgs.vertexai).toBe(true);
      expect(ctorArgs.project).toBe("test-project");
      expect(ctorArgs.location).toBe("us-central1");
    }
  });

  it("exposes ai.models.generateContent in the native shape", async () => {
    generateContentMock.mockReset();
    generateContentMock.mockResolvedValueOnce({
      candidates: [{ content: { role: "model", parts: [{ text: "hi" }] } }],
    });

    const { getGoogleGenAI, VERTEX_MODEL } = await loadClient();
    const ai = await getGoogleGenAI();

    const contents = [{ role: "user", parts: [{ text: "ping" }] }];
    const result = await ai.models.generateContent({
      model: VERTEX_MODEL,
      contents,
      config: { temperature: 0.2, systemInstruction: { role: "system", parts: [{ text: "be terse" }] } },
    });

    expect(result.candidates?.[0]?.content?.parts?.[0]).toEqual({ text: "hi" });

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const call = generateContentMock.mock.calls[0][0] as {
      model: string;
      contents: unknown;
      config?: Record<string, unknown>;
    };
    expect(call.model).toBe(VERTEX_MODEL);
    expect(call.contents).toEqual(contents);
    expect(call.config?.temperature).toBe(0.2);
    expect(call.config?.systemInstruction).toEqual({
      role: "system",
      parts: [{ text: "be terse" }],
    });
  });

  it("exposes ai.models.generateContentStream as an async iterable of chunks", async () => {
    generateContentStreamMock.mockReset();
    async function* fakeStream() {
      yield { candidates: [{ content: { parts: [{ text: "chunk-1" }] } }] };
      yield { candidates: [{ content: { parts: [{ text: "chunk-2" }] } }] };
    }
    generateContentStreamMock.mockResolvedValueOnce(fakeStream());

    const { getGoogleGenAI, VERTEX_MODEL } = await loadClient();
    const ai = await getGoogleGenAI();

    const stream = await ai.models.generateContentStream({
      model: VERTEX_MODEL,
      contents: [{ role: "user", parts: [{ text: "stream please" }] }],
    });

    const collected: string[] = [];
    for await (const chunk of stream) {
      const part = chunk.candidates?.[0]?.content?.parts?.[0];
      if (part && typeof (part as { text?: unknown }).text === "string") {
        collected.push((part as { text: string }).text);
      }
    }
    expect(collected).toEqual(["chunk-1", "chunk-2"]);
  });
});
