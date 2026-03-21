import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { parsePDF, parseDOCX } from "@/lib/parseFile";
import { chunkText } from "@/lib/chunkText";
import { generateCardsFromChunk } from "@/lib/generateCards";

if (!getApps().length) {
	initializeApp({
		credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY!)),
		storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	});
}

export async function POST(req: NextRequest) {
	let setId: string | null = null;
	try {
		const body = await req.json();
		setId = typeof body.setId === "string" ? body.setId : null;

		if (!setId) {
			return NextResponse.json({ error: "Missing setId" }, { status: 400 });
		}

		const db = getFirestore();
		const bucket = getStorage().bucket();

		const setRef = db.collection("studySets").doc(setId);
		const setSnap = await setRef.get();

		if (!setSnap.exists) {
			return NextResponse.json(
				{ error: "Study set not found" },
				{ status: 404 },
			);
		}

		const setData = setSnap.data();
		if (!setData) {
			return NextResponse.json(
				{ error: "Missing study set data" },
				{ status: 500 },
			);
		}

			const filePath = typeof setData.filePath === "string" ? setData.filePath : "";
			const rawFileName = typeof setData.fileName === "string" ? setData.fileName : "";

			if (!filePath || !rawFileName) {
				await setRef.update({
					status: "error",
					lastError: "Studiesettet mangler filreferanse.",
				});
				return NextResponse.json(
					{ error: "Study set is missing file reference" },
					{ status: 400 },
				);
			}

			if (setData.status === "processing") {
				return NextResponse.json(
					{ error: "Study set is already processing" },
					{ status: 409 },
				);
			}

		await setRef.update({ status: "processing", lastError: null });

			const file = bucket.file(filePath);
		const [buffer] = await file.download();

		let text = "";
			const fileName = rawFileName.toLowerCase();

		if (fileName.endsWith(".pdf")) {
			text = await parsePDF(buffer);
		} else if (fileName.endsWith(".docx")) {
			text = await parseDOCX(buffer);
			} else {
				await setRef.update({ status: "error", lastError: "Unsupported file type" });
			return NextResponse.json(
				{ error: "Unsupported file type" },
				{ status: 400 },
			);
		}

		if (!text || text.trim().length < 100) {
			await setRef.update({ status: "error", lastError: "Too little text extracted" });
			return NextResponse.json(
				{ error: "Too little text extracted" },
				{ status: 400 },
			);
		}

		const chunks = chunkText(text, 4000).slice(0, 4);

		if (chunks.length === 0) {
			await setRef.update({
				status: "error",
				lastError: "No usable text chunks extracted",
			});
			return NextResponse.json(
				{ error: "No usable text chunks extracted" },
				{ status: 400 },
			);
		}

		const cardsCol = setRef.collection("cards");

		const existingCards = await cardsCol.get();
		const deletePromises = existingCards.docs.map((d) => d.ref.delete());
		await Promise.all(deletePromises);

		const allCards: Array<{
			question: string;
			answer: string;
			difficulty: "easy" | "medium" | "hard";
		}> = [];

		for (const chunk of chunks) {
			const cards = await generateCardsFromChunk(chunk);
			allCards.push(...cards);
		}

		const deduped = allCards.filter((card, index, arr) => {
			const key = `${card.question}__${card.answer}`.toLowerCase().trim();
			return (
				arr.findIndex(
					(x) => `${x.question}__${x.answer}`.toLowerCase().trim() === key,
				) === index
			);
		});

		await Promise.all(
			deduped.map((card) =>
				cardsCol.add({
					...card,
					createdAt: new Date().toISOString(),
				}),
			),
		);

		await setRef.update({
			status: "ready",
			cardCount: deduped.length,
			extractedTextLength: text.length,
			lastError: null,
		});

		return NextResponse.json({
			success: true,
			cardCount: deduped.length,
		});
	} catch (error) {
		console.error("PROCESS ERROR:", error);

		if (setId) {
			await getFirestore()
				.collection("studySets")
				.doc(setId)
				.update({
					status: "error",
					lastError: error instanceof Error ? error.message : "Unknown error",
				})
				.catch((updateError) => {
					console.error("FAILED TO UPDATE ERROR STATUS:", updateError);
				});
		}

		return NextResponse.json(
			{ error: "Failed to process study set" },
			{ status: 500 },
		);
	}
}
