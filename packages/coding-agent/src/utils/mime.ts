import { open } from "node:fs/promises";
import { extname } from "node:path";

const MEDIA_TYPE_SNIFF_BYTES = 4100;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function detectSupportedImageMimeType(buffer: Uint8Array): string | null {
	if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
		return buffer[3] === 0xf7 ? null : "image/jpeg";
	}
	if (startsWith(buffer, PNG_SIGNATURE)) {
		return isPng(buffer) && !isAnimatedPng(buffer) ? "image/png" : null;
	}
	if (startsWithAscii(buffer, 0, "GIF")) {
		return "image/gif";
	}
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WEBP")) {
		return "image/webp";
	}
	return null;
}

export function detectSupportedMediaMimeType(buffer: Uint8Array, filePath?: string): string | null {
	const imageMimeType = detectSupportedImageMimeType(buffer);
	if (imageMimeType) return imageMimeType;
	if (startsWithAscii(buffer, 0, "%PDF-")) return "application/pdf";
	if (startsWithAscii(buffer, 0, "ID3") || isMp3Frame(buffer)) return "audio/mpeg";
	if (startsWithAscii(buffer, 0, "fLaC")) return "audio/flac";
	if (startsWithAscii(buffer, 0, "OggS")) return "audio/ogg";
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "WAVE")) return "audio/wav";
	if (startsWithAscii(buffer, 0, "RIFF") && startsWithAscii(buffer, 8, "AVI ")) return "video/x-msvideo";
	if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
		return asciiLower(buffer.subarray(0, Math.min(buffer.length, 1024))).includes("webm")
			? "video/webm"
			: "video/x-matroska";
	}
	if (startsWithAscii(buffer, 4, "ftyp")) {
		const ext = filePath ? extname(filePath).toLowerCase() : "";
		if (ext === ".m4a" || ext === ".aac") return "audio/mp4";
		if (startsWithAscii(buffer, 8, "qt  ")) return "video/quicktime";
		return "video/mp4";
	}
	return null;
}

export async function detectSupportedImageMimeTypeFromFile(filePath: string): Promise<string | null> {
	const mimeType = await detectSupportedMediaMimeTypeFromFile(filePath);
	return mimeType?.startsWith("image/") ? mimeType : null;
}

export async function detectSupportedMediaMimeTypeFromFile(filePath: string): Promise<string | null> {
	const fileHandle = await open(filePath, "r");
	try {
		const buffer = Buffer.alloc(MEDIA_TYPE_SNIFF_BYTES);
		const { bytesRead } = await fileHandle.read(buffer, 0, MEDIA_TYPE_SNIFF_BYTES, 0);
		return detectSupportedMediaMimeType(buffer.subarray(0, bytesRead), filePath);
	} finally {
		await fileHandle.close();
	}
}

function isPng(buffer: Uint8Array): boolean {
	return (
		buffer.length >= 16 && readUint32BE(buffer, PNG_SIGNATURE.length) === 13 && startsWithAscii(buffer, 12, "IHDR")
	);
}

function isAnimatedPng(buffer: Uint8Array): boolean {
	let offset = PNG_SIGNATURE.length;
	while (offset + 8 <= buffer.length) {
		const chunkLength = readUint32BE(buffer, offset);
		const chunkTypeOffset = offset + 4;
		if (startsWithAscii(buffer, chunkTypeOffset, "acTL")) return true;
		if (startsWithAscii(buffer, chunkTypeOffset, "IDAT")) return false;

		const nextOffset = offset + 8 + chunkLength + 4;
		if (nextOffset <= offset || nextOffset > buffer.length) return false;
		offset = nextOffset;
	}
	return false;
}

function isMp3Frame(buffer: Uint8Array): boolean {
	return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

function readUint32BE(buffer: Uint8Array, offset: number): number {
	return (
		(buffer[offset] ?? 0) * 0x1000000 +
		((buffer[offset + 1] ?? 0) << 16) +
		((buffer[offset + 2] ?? 0) << 8) +
		(buffer[offset + 3] ?? 0)
	);
}

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
	if (buffer.length < bytes.length) return false;
	return bytes.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
	if (buffer.length < offset + text.length) return false;
	for (let index = 0; index < text.length; index++) {
		if (buffer[offset + index] !== text.charCodeAt(index)) return false;
	}
	return true;
}

function asciiLower(buffer: Uint8Array): string {
	return Array.from(buffer)
		.map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte).toLowerCase() : ""))
		.join("");
}
