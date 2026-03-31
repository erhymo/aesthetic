import { NextRequest, NextResponse } from "next/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setSessionCookie } from "@/lib/authSession";
import { withRetry } from "@/lib/transientRetry";

export const runtime = "nodejs";
export const maxDuration = 60;

if (!getApps().length) {
	initializeApp({
		credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY!)),
		storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	});
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const pin = typeof body.pin === "string" ? body.pin.trim() : "";

		if (!/^\d{4}$/.test(pin)) {
			return NextResponse.json({ error: "Legg inn en gyldig PIN-kode." }, { status: 400 });
		}

		const db = getFirestore();
		const usersSnap = await withRetry("login user lookup", () =>
			db.collection("users").where("pin", "==", pin).limit(1).get(),
		);

		if (usersSnap.empty) {
			return NextResponse.json({ error: "Feil PIN-kode." }, { status: 401 });
		}

		const userId = usersSnap.docs[0]?.id;

		if (!userId) {
			return NextResponse.json({ error: "Fant ikke brukeren." }, { status: 500 });
		}

		const response = NextResponse.json({ success: true, userId });
		setSessionCookie(response, userId);

		return response;
	} catch (error) {
		console.error("LOGIN ERROR:", error);
		const errorMessage =
			error instanceof Error && error.message.trim().length > 0
				? error.message
				: "Kunne ikke logge inn.";

		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}