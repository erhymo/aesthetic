import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
	extractTextFromFileBuffer,
	getTextExtractionError,
	generateSummaryFromText,
	type DocumentSummary,
} from "@/lib/parseFile";
import { getAuthenticatedUserId } from "@/lib/authSession";
import { getStoredStudySetFiles } from "@/lib/studySetFiles";
import { getErrorMessage, withRetry } from "@/lib/transientRetry";

export const runtime = "nodejs";
export const maxDuration = 60;

if (!getApps().length) {
	initializeApp({
		credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY!)),
		storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	});
}

function getStoredSummary(data: Record<string, unknown>): DocumentSummary | null {
	if (
		typeof data.summaryTitle !== "string" ||
		typeof data.summaryIntro !== "string" ||
		typeof data.summaryTakeaway !== "string" ||
		typeof data.summarySimpleExplanation !== "string" ||
		!Array.isArray(data.summaryBullets)
	) {
		return null;
	}

	const bullets = data.summaryBullets.filter(
		(bullet): bullet is string => typeof bullet === "string" && bullet.trim().length > 0,
	);

	if (bullets.length === 0) {
		return null;
	}

	return {
		title: data.summaryTitle,
		intro: data.summaryIntro,
		bullets,
		takeaway: data.summaryTakeaway,
		simpleExplanation: data.summarySimpleExplanation,
	};
}

async function updateSummaryState(setId: string, data: Record<string, unknown>) {
	await withRetry("summary status update", () =>
		getFirestore().collection("studySets").doc(setId).update(data),
	);
}

export async function POST(req: NextRequest) {
	let setId: string | null = null;

	try {
		const body = await req.json();
		setId = typeof body.setId === "string" ? body.setId : null;
		const force = body.force === true;

		if (!setId) {
			return NextResponse.json({ error: "Mangler studiesett-id." }, { status: 400 });
		}

		const userId = await getAuthenticatedUserId();

		if (!userId) {
			return NextResponse.json({ error: "Du må logge inn på nytt." }, { status: 401 });
		}

		const db = getFirestore();
		const bucket = getStorage().bucket();
		const setRef = db.collection("studySets").doc(setId);
		const setSnap = await withRetry("study set lookup", () => setRef.get());

		if (!setSnap.exists) {
			return NextResponse.json({ error: "Fant ikke studiesettet." }, { status: 404 });
		}

		const setData = setSnap.data();

		if (!setData) {
			return NextResponse.json({ error: "Mangler studiesettdata." }, { status: 500 });
		}

		const ownerId = typeof setData.userId === "string" ? setData.userId : null;

		if (!ownerId) {
			return NextResponse.json({ error: "Mangler studiesettdata." }, { status: 500 });
		}

		if (ownerId !== userId) {
			return NextResponse.json(
				{ error: "Du har ikke tilgang til dette studiesettet." },
				{ status: 403 },
			);
		}

		const cachedSummary = getStoredSummary(setData);

		if (!force && cachedSummary && setData.summaryStatus === "ready") {
			return NextResponse.json({ success: true, cached: true, summary: cachedSummary });
		}

			const storedFiles = getStoredStudySetFiles(setData as Record<string, unknown>);

			if (storedFiles.length === 0) {
			await updateSummaryState(setId, {
				summaryStatus: "error",
				summaryLastError: "Studiesettet mangler filreferanse.",
			});

			return NextResponse.json(
				{ error: "Studiesettet mangler filreferanse." },
				{ status: 400 },
			);
		}

		if (setData.summaryStatus === "processing") {
			return NextResponse.json(
				{ error: "Oppsummering genereres allerede." },
				{ status: 409 },
			);
		}

		await updateSummaryState(setId, {
			summaryStatus: "processing",
			summaryLastError: null,
		});
		let text = "";

		try {
				const extractedTexts: string[] = [];

				for (const [index, storedFile] of storedFiles.entries()) {
					const file = bucket.file(storedFile.filePath);
					const [buffer] = await withRetry("summary file download", () => file.download());
					const extractedText = await extractTextFromFileBuffer(buffer, storedFile.fileName);

					extractedTexts.push(`Kilde ${index + 1}: ${storedFile.fileName}\n${extractedText.trim()}`);
				}

				text = extractedTexts.join("\n\n").trim();
			} catch (error) {
				const extractionError = getTextExtractionError(error);

			await updateSummaryState(setId, {
				summaryStatus: "error",
					summaryLastError: extractionError.message,
			});

			return NextResponse.json(
					{ error: extractionError.message },
					{ status: extractionError.status },
			);
		}

		if (!text || text.trim().length < 100) {
			await updateSummaryState(setId, {
				summaryStatus: "error",
					summaryLastError: "Det ble hentet ut for lite tekst fra materialet.",
			});

			return NextResponse.json(
					{ error: "Det ble hentet ut for lite tekst fra materialet." },
				{ status: 400 },
			);
		}

		const summary = await generateSummaryFromText(text);

		await updateSummaryState(setId, {
			summaryStatus: "ready",
			summaryTitle: summary.title,
			summaryIntro: summary.intro,
			summaryBullets: summary.bullets,
			summaryTakeaway: summary.takeaway,
			summarySimpleExplanation: summary.simpleExplanation,
			summarySourceLength: text.length,
			summaryUpdatedAt: new Date().toISOString(),
			summaryLastError: null,
		});

		return NextResponse.json({ success: true, cached: false, summary });
	} catch (error) {
		console.error("SUMMARY ERROR:", error);
		const errorMessage = getErrorMessage(error);

		if (setId) {
			await updateSummaryState(setId, {
				summaryStatus: "error",
				summaryLastError: errorMessage,
			})
				.catch((updateError) => {
					console.error("FAILED TO UPDATE SUMMARY ERROR STATUS:", updateError);
				});
		}

		return NextResponse.json({ error: errorMessage }, { status: 500 });
	}
}