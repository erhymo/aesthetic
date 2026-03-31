import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "aesthetic_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

type SessionPayload = {
	userId: string;
	expiresAt: number;
};

function getSessionSecret() {
	const secret = process.env.AUTH_SESSION_SECRET ?? process.env.FIREBASE_ADMIN_KEY ?? "";

	if (!secret) {
		throw new Error("Mangler hemmelig nøkkel for innloggingssession.");
	}

	return secret;
}

function toBase64Url(value: string) {
	return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url<T>(value: string): T | null {
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
	} catch {
		return null;
	}
}

function signValue(value: string) {
	return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

function hasValidSignature(value: string, signature: string) {
	const expected = Buffer.from(signValue(value), "utf8");
	const received = Buffer.from(signature, "utf8");

	return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createSessionToken(userId: string) {
	const payload: SessionPayload = {
		userId,
		expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
	};
	const encodedPayload = toBase64Url(JSON.stringify(payload));

	return `${encodedPayload}.${signValue(encodedPayload)}`;
}

export function readSessionToken(token: string): SessionPayload | null {
	const [encodedPayload, signature] = token.split(".");

	if (!encodedPayload || !signature || !hasValidSignature(encodedPayload, signature)) {
		return null;
	}

	const payload = fromBase64Url<SessionPayload>(encodedPayload);

	if (
		!payload ||
		typeof payload.userId !== "string" ||
		payload.userId.trim().length === 0 ||
		typeof payload.expiresAt !== "number" ||
		!Number.isFinite(payload.expiresAt) ||
		payload.expiresAt <= Date.now()
	) {
		return null;
	}

	return payload;
}

export async function getAuthenticatedUserId() {
	const cookieStore = await cookies();
	const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

	if (!token) {
		return null;
	}

	return readSessionToken(token)?.userId ?? null;
}

export function setSessionCookie(response: NextResponse, userId: string) {
	response.cookies.set({
		name: SESSION_COOKIE_NAME,
		value: createSessionToken(userId),
		httpOnly: true,
		sameSite: "lax",
		secure: process.env.NODE_ENV === "production",
		path: "/",
		maxAge: SESSION_MAX_AGE_SECONDS,
	});
}