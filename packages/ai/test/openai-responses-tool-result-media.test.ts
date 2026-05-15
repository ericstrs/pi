import { describe, expect, it } from "vitest";
import { convertResponsesMessages } from "../src/providers/openai-responses-shared.js";
import type { AssistantMessage, Context, Model, ToolResultMessage, Usage } from "../src/types.js";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<"openai-responses"> = {
	id: "test-openai-pdf",
	name: "Test OpenAI PDF",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text", "image", "pdf"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

describe("OpenAI Responses tool result media", () => {
	it("downgrades audio and video user media to visible placeholders", () => {
		const avModel: Model<"openai-responses"> = {
			...model,
			id: "test-openai-av",
			name: "Test OpenAI audio/video",
			input: ["text", "image", "pdf", "audio", "video"],
		};
		const now = Date.now();
		const context: Context = {
			systemPrompt: "You are concise.",
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "inspect these" },
						{ type: "audio", data: "audio-base64", mimeType: "audio/mpeg", name: "test.mp3" },
						{ type: "video", data: "video-base64", mimeType: "video/mp4", name: "clip.mp4" },
					],
					timestamp: now,
				},
			],
		};

		const input = convertResponsesMessages(avModel, context, new Set(["openai"]));
		const userMessage = input.find((item) => isRecord(item) && item.role === "user");

		expect(userMessage).toBeDefined();
		if (!isRecord(userMessage) || !Array.isArray(userMessage.content))
			throw new Error("Expected user message content");

		expect(userMessage.content).toContainEqual({ type: "input_text", text: "inspect these" });
		expect(userMessage.content).toContainEqual({
			type: "input_text",
			text: "(audio omitted: OpenAI Responses serializer does not support native audio)",
		});
		expect(userMessage.content).toContainEqual({
			type: "input_text",
			text: "(video omitted: OpenAI Responses serializer does not support native video)",
		});
		expect(
			userMessage.content.some(
				(item) => isRecord(item) && (item.type === "input_audio" || item.type === "input_video"),
			),
		).toBe(false);
	});

	it("sends PDF tool results as input_file content in function_call_output", () => {
		const now = Date.now();
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{ type: "toolCall", id: "call_read|fc_read", name: "read", arguments: { path: "verification.pdf" } },
			],
			api: "openai-responses",
			provider: "openai",
			model: model.id,
			usage,
			stopReason: "toolUse",
			timestamp: now,
		};
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call_read|fc_read",
			toolName: "read",
			content: [
				{ type: "text", text: "Read PDF file [application/pdf]" },
				{ type: "pdf", data: "pdf-base64", mimeType: "application/pdf", name: "verification.pdf" },
			],
			isError: false,
			timestamp: now,
		};
		const context: Context = {
			systemPrompt: "You are concise.",
			messages: [{ role: "user", content: "use the tool", timestamp: now }, assistant, toolResult],
		};

		const input = convertResponsesMessages(model, context, new Set(["openai"]));
		const outputItem = input.find((item) => item.type === "function_call_output");

		expect(outputItem).toBeDefined();
		if (!outputItem || outputItem.type !== "function_call_output") throw new Error("Expected function_call_output");
		expect(Array.isArray(outputItem.output)).toBe(true);
		if (!Array.isArray(outputItem.output)) throw new Error("Expected content array output");

		const text = outputItem.output.find((item) => isRecord(item) && item.type === "input_text");
		const file = outputItem.output.find((item) => isRecord(item) && item.type === "input_file");

		expect(text).toMatchObject({ type: "input_text", text: "Read PDF file [application/pdf]" });
		expect(file).toMatchObject({
			type: "input_file",
			filename: "verification.pdf",
			file_data: "data:application/pdf;base64,pdf-base64",
		});
	});
});
