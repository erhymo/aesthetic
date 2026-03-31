import { getApiResponseErrorMessage, parseApiJson } from "@/lib/apiResponse";

type SessionResponse = {
	error?: string;
	userId?: string;
};

export type ClientSessionResult = {
	userId: string | null;
	error: string | null;
	unauthorized: boolean;
};

export async function fetchClientSession(): Promise<ClientSessionResult> {
	const response = await fetch("/api/session", { cache: "no-store" });
	const rawBody = await response.text();
	const json = parseApiJson<SessionResponse>(rawBody);
	const responseError = getApiResponseErrorMessage(rawBody, "Kunne ikke laste innloggingen.");

	if (!response.ok || typeof json?.userId !== "string") {
		return {
			userId: null,
			error: json?.error?.trim() || responseError,
			unauthorized: response.status === 401,
		};
	}

	return {
		userId: json.userId,
		error: null,
		unauthorized: false,
	};
}