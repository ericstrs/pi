import { beforeEach, describe, expect, it, vi } from "vitest";
import { getModel } from "../src/models.js";
import type { AssistantMessage, Context, ToolResultMessage, Usage } from "../src/types.js";

const mockState = vi.hoisted(() => ({
	createParams: undefined as Record<string, unknown> | undefined,
}));

vi.mock("@anthropic-ai/sdk", () => {
	function createSseResponse(): Response {
		const body = [
			`event: message_start\ndata: ${JSON.stringify({
				type: "message_start",
				message: {
					id: "msg_test",
					usage: { input_tokens: 10, output_tokens: 0 },
				},
			})}\n`,
			`event: message_delta\ndata: ${JSON.stringify({
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { output_tokens: 5 },
			})}\n`,
		].join("\n");

		return new Response(body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}

	class FakeAnthropic {
		messages = {
			create: (params: Record<string, unknown>) => {
				mockState.createParams = params;
				return {
					asResponse: async () => createSseResponse(),
				};
			},
		};
	}

	return { default: FakeAnthropic };
});

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object") throw new Error("Expected object");
	return value as Record<string, unknown>;
}

async function captureAnthropicMessages(context: Context): Promise<Record<string, unknown>[]> {
	const { streamAnthropic } = await import("../src/providers/anthropic.js");
	const model = getModel("anthropic", "claude-sonnet-4-6");
	const stream = streamAnthropic(model, context, { apiKey: "test-key" });
	for await (const event of stream) {
		if (event.type === "error") break;
	}
	await stream.result();

	const params = mockState.createParams;
	if (!params || !Array.isArray(params.messages)) throw new Error("Expected Anthropic messages payload");
	return params.messages as Record<string, unknown>[];
}

describe("Anthropic media serialization", () => {
	beforeEach(() => {
		mockState.createParams = undefined;
	});

	it("serializes user PDF blocks as documents, not images", async () => {
		const messages = await captureAnthropicMessages({
			systemPrompt: "You are concise.",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "summarize this" },
						{ type: "pdf", data: "pdf-base64", mimeType: "application/pdf", name: "sample.pdf" },
					],
					timestamp: Date.now(),
				},
			],
		});

		const content = messages[0]?.content;
		expect(Array.isArray(content)).toBe(true);
		const blocks = content as Record<string, unknown>[];
		expect(blocks[1]?.type).toBe("document");
		expect(asRecord(blocks[1]?.source).media_type).toBe("application/pdf");
		expect(blocks[1]?.title).toBe("sample.pdf");
	});

	it("serializes tool result images and PDFs as native Anthropic blocks", async () => {
		const now = Date.now();
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [{ type: "toolCall", id: "toolu_read", name: "read", arguments: { path: "sample.pdf" } }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			usage,
			stopReason: "toolUse",
			timestamp: now,
		};
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "toolu_read",
			toolName: "read",
			content: [
				{ type: "text", text: "Read media files" },
				{ type: "image", data: "image-base64", mimeType: "image/png" },
				{ type: "pdf", data: "pdf-base64", mimeType: "application/pdf", name: "sample.pdf" },
			],
			isError: false,
			timestamp: now,
		};

		const messages = await captureAnthropicMessages({
			systemPrompt: "You are concise.",
			messages: [{ role: "user", content: "use the tool", timestamp: now }, assistant, toolResult],
		});

		const toolResultBlock = (messages[2]?.content as Record<string, unknown>[])[0];
		expect(toolResultBlock?.type).toBe("tool_result");
		const content = toolResultBlock.content as Record<string, unknown>[];
		expect(content.some((block) => block.type === "image" && asRecord(block.source).media_type === "image/png")).toBe(
			true,
		);
		expect(
			content.some((block) => block.type === "document" && asRecord(block.source).media_type === "application/pdf"),
		).toBe(true);
	});
});
