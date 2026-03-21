import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
	extractTextFromFileBuffer,
	generateSummaryFromText,
	type DocumentSummary,
} from "@/lib/parseFile";

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
	};
}

export async function POST(req: NextRequest) {
	let setId: string | null = null;

	try {
		const body = await req.json();
		setId = typeof body.setId === "string" ? body.setId : null;
		const force = body.force === true;

		if (!setId) {
			return NextResponse.json({ error: "Missing setId" }, { status: 400 });
		}

		const db = getFirestore();
		const bucket = getStorage().bucket();
		const setRef = db.collection("studySets").doc(setId);
		const setSnap = await setRef.get();

		if (!setSnap.exists) {
			return NextResponse.json({ error: "Study set not found" }, { status: 404 });
		}

		const setData = setSnap.data();

		if (!setData) {
			return NextResponse.json({ error: "Missing study set data" }, { status: 500 });
		}

		const cachedSummary = getStoredSummary(setData);

		if (!force && cachedSummary && setData.summaryStatus === "ready") {
			return NextResponse.json({ success: true, cached: true, summary: cachedSummary });
		}

		const filePath = typeof setData.filePath === "string" ? setData.filePath : "";
		const rawFileName = typeof setData.fileName === "string" ? setData.fileName : "";

		if (!filePath || !rawFileName) {
			await setRef.update({
				summaryStatus: "error",
				summaryLastError: "Studiesettet mangler filreferanse.",
			});

			return NextResponse.json(
				{ error: "Study set is missing file reference" },
				{ status: 400 },
			);
		}

		if (setData.summaryStatus === "processing") {
			return NextResponse.json(
				{ error: "Summary is already processing" },
				{ status: 409 },
			);
		}

		await setRef.update({
			summaryStatus: "processing",
			summaryLastError: null,
		});

		const file = bucket.file(filePath);
		const [buffer] = await file.download();
		let text = "";

		try {
			text = await extractTextFromFileBuffer(buffer, rawFileName);
		} catch {
			await setRef.update({
				summaryStatus: "error",
				summaryLastError: "Unsupported file type",
			});

			return NextResponse.json(
				{ error: "Unsupported file type" },
				{ status: 400 },
			);
		}

		if (!text || text.trim().length < 100) {
			await setRef.update({
				summaryStatus: "error",
				summaryLastError: "Too little text extracted",
			});

			return NextResponse.json(
				{ error: "Too little text extracted" },
				{ status: 400 },
			);
		}

		const summary = await generateSummaryFromText(text);

		await setRef.update({
			summaryStatus: "ready",
			summaryTitle: summary.title,
			summaryIntro: summary.intro,
			summaryBullets: summary.bullets,
			summaryTakeaway: summary.takeaway,
			summarySourceLength: text.length,
			summaryUpdatedAt: new Date().toISOString(),
			summaryLastError: null,
		});

		return NextResponse.json({ success: true, cached: false, summary });
	} catch (error) {
		console.error("SUMMARY ERROR:", error);

		if (setId) {
			await getFirestore()
				.collection("studySets")
				.doc(setId)
				.update({
					summaryStatus: "error",
					summaryLastError:
						error instanceof Error ? error.message : "Unknown summary error",
				})
				.catch((updateError) => {
					console.error("FAILED TO UPDATE SUMMARY ERROR STATUS:", updateError);
				});
		}

		return NextResponse.json(
			{ error: "Failed to generate summary" },
			{ status: 500 },
		);
	}
}