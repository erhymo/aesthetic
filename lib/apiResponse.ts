export function parseApiJson<T extends Record<string, unknown>>(rawBody: string): T | null {
	const trimmed = rawBody.trim();

	if (!trimmed) {
		return null;
	}

	try {
		return JSON.parse(trimmed) as T;
	} catch {
		return null;
	}
}

export function looksLikeHtmlResponse(rawBody: string) {
	const trimmed = rawBody.trim().toLowerCase();

	return (
		trimmed.startsWith("<!doctype html") ||
		trimmed.startsWith("<html") ||
		trimmed.includes("<body") ||
		trimmed.includes("id=\"__next_error__\"")
	);
}

export function getApiResponseErrorMessage(rawBody: string, fallbackMessage: string) {
	const parsed = parseApiJson<{ error?: string }>(rawBody);

	if (typeof parsed?.error === "string" && parsed.error.trim().length > 0) {
		return parsed.error.trim();
	}

	const trimmed = rawBody.trim();

	if (!trimmed || looksLikeHtmlResponse(trimmed) || trimmed.length > 400) {
		return fallbackMessage;
	}

	return trimmed;
}