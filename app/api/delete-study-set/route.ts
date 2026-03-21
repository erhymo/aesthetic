import { NextRequest, NextResponse } from "next/server";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getStoredStudySetFiles } from "@/lib/studySetFiles";

export const runtime = "nodejs";
export const maxDuration = 60;

if (!getApps().length) {
	initializeApp({
		credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY!)),
		storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	});
}

async function deleteCardsSubcollection(setId: string) {
	const db = getFirestore();
	const cardsSnap = await db.collection("studySets").doc(setId).collection("cards").get();

	if (cardsSnap.empty) {
		return;
	}

	const docs = cardsSnap.docs;

	for (let index = 0; index < docs.length; index += 450) {
		const batch = db.batch();

		for (const cardDoc of docs.slice(index, index + 450)) {
			batch.delete(cardDoc.ref);
		}

		await batch.commit();
	}
}

export async function POST(req: NextRequest) {
	try {
		const body = await req.json();
		const setId = typeof body.setId === "string" ? body.setId : "";
		const userId = typeof body.userId === "string" ? body.userId : "";

		if (!setId) {
			return NextResponse.json({ error: "Mangler studiesett-id." }, { status: 400 });
		}

		if (!userId) {
			return NextResponse.json({ error: "Mangler bruker-id." }, { status: 400 });
		}

		const db = getFirestore();
		const bucket = getStorage().bucket();
		const setRef = db.collection("studySets").doc(setId);
		const setSnap = await setRef.get();

		if (!setSnap.exists) {
			return NextResponse.json({ error: "Fant ikke studiesettet." }, { status: 404 });
		}

		const setData = setSnap.data();

		if (!setData) {
			return NextResponse.json({ error: "Mangler studiesettdata." }, { status: 500 });
		}

		if (setData.userId !== userId) {
			return NextResponse.json({ error: "Du har ikke tilgang til å slette dette studiesettet." }, { status: 403 });
		}

		const storedFiles = getStoredStudySetFiles(setData as Record<string, unknown>);
		const uniqueFilePaths = Array.from(new Set(storedFiles.map((file) => file.filePath)));

		for (const filePath of uniqueFilePaths) {
			await bucket.file(filePath).delete({ ignoreNotFound: true });
		}

		await deleteCardsSubcollection(setId);
		await setRef.delete();

		return NextResponse.json({ success: true });
	} catch (error) {
		console.error("DELETE STUDY SET ERROR:", error);

		const errorMessage =
			error instanceof Error && error.message.trim().length > 0
				? error.message
				: "Kunne ikke slette studiesettet.";

		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}