import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import {
	buildFeedbackProfile,
	extractTextFromFileBuffer,
	getTextExtractionError,
	generateCardsFromChunk,
	groupChunksForCards,
	type Flashcard,
	type FeedbackSignalCard,
} from "@/lib/parseFile";
import { getStoredStudySetFiles } from "@/lib/studySetFiles";

export const runtime = "nodejs";
export const maxDuration = 60;

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
				return NextResponse.json({ error: "Mangler studiesett-id." }, { status: 400 });
		}

		const db = getFirestore();
		const bucket = getStorage().bucket();

		const setRef = db.collection("studySets").doc(setId);
		const setSnap = await setRef.get();

		if (!setSnap.exists) {
			return NextResponse.json(
					{ error: "Fant ikke studiesettet." },
				{ status: 404 },
			);
		}

		const setData = setSnap.data();
		if (!setData) {
			return NextResponse.json(
					{ error: "Mangler studiesettdata." },
				{ status: 500 },
			);
		}

			const storedFiles = getStoredStudySetFiles(setData as Record<string, unknown>);

			if (storedFiles.length === 0) {
			await setRef.update({
				status: "error",
				lastError: "Studiesettet mangler filreferanse.",
			});

			return NextResponse.json(
					{ error: "Studiesettet mangler filreferanse." },
				{ status: 400 },
			);
		}

		if (setData.status === "processing") {
			return NextResponse.json(
					{ error: "Generering pågår allerede." },
				{ status: 409 },
			);
		}

		await setRef.update({ status: "processing", lastError: null });
		let text = "";

		try {
				const extractedTexts: string[] = [];

				for (const [index, storedFile] of storedFiles.entries()) {
					const file = bucket.file(storedFile.filePath);
					const [buffer] = await file.download();
					const extractedText = await extractTextFromFileBuffer(buffer, storedFile.fileName);

					extractedTexts.push(`Kilde ${index + 1}: ${storedFile.fileName}\n${extractedText.trim()}`);
				}

				text = extractedTexts.join("\n\n").trim();
			} catch (error) {
				const extractionError = getTextExtractionError(error);

				await setRef.update({ status: "error", lastError: extractionError.message });
			return NextResponse.json(
					{ error: extractionError.message },
					{ status: extractionError.status },
			);
		}

		if (!text || text.trim().length < 100) {
				await setRef.update({
					status: "error",
						lastError: "Det ble hentet ut for lite tekst fra materialet.",
				});
			return NextResponse.json(
						{ error: "Det ble hentet ut for lite tekst fra materialet." },
				{ status: 400 },
			);
		}

			const chunks = groupChunksForCards(text);

		if (chunks.length === 0) {
			await setRef.update({
				status: "error",
						lastError: "Fant ingen brukbare tekstavsnitt i materialet.",
			});
			return NextResponse.json(
						{ error: "Fant ingen brukbare tekstavsnitt i materialet." },
				{ status: 400 },
			);
		}

		const cardsCol = setRef.collection("cards");

		const existingCards = await cardsCol.get();
		const feedbackSignalCards: FeedbackSignalCard[] = existingCards.docs.flatMap((cardDoc) => {
				const data = cardDoc.data();
				const question = typeof data.question === "string" ? data.question : "";
				const difficulty =
					data.difficulty === "easy" ||
					data.difficulty === "medium" ||
					data.difficulty === "hard"
						? data.difficulty
						: null;
				const feedback =
					data.feedback === "up" || data.feedback === "down" ? data.feedback : null;

				if (!question || !difficulty) {
					return [];
				}

				return [{ question, difficulty, feedback }];
			});

		const feedbackProfile = buildFeedbackProfile(feedbackSignalCards);

		const allCards: Flashcard[] = [];

		for (const chunk of chunks) {
			const cards = await generateCardsFromChunk(chunk, feedbackProfile);
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

		if (deduped.length === 0) {
			await setRef.update({
				status: "error",
				lastError:
					"Klarte ikke å lage brukbare flashcards fra teksten. Prøv igjen, eller last opp en fil med tydeligere sammenhengende tekst.",
			});

			return NextResponse.json(
					{
						error:
							"Klarte ikke å lage brukbare flashcards fra teksten. Prøv igjen, eller last opp en fil med tydeligere sammenhengende tekst.",
					},
				{ status: 400 },
			);
		}

		const generatedAt = new Date().toISOString();
		const batch = db.batch();

		existingCards.docs.forEach((cardDoc) => {
			batch.delete(cardDoc.ref);
		});

		deduped.forEach((card) => {
			batch.set(cardsCol.doc(), {
				...card,
				createdAt: generatedAt,
			});
		});

		await batch.commit();

		await setRef.update({
			status: "ready",
			cardCount: deduped.length,
			extractedTextLength: text.length,
			feedbackProfile,
			feedbackProfileUpdatedAt: generatedAt,
			lastError: null,
		});

		return NextResponse.json({
			success: true,
			cardCount: deduped.length,
		});
		} catch (error) {
		console.error("PROCESS ERROR:", error);
			const errorMessage =
				error instanceof Error && error.message.trim().length > 0
					? error.message
					: "Ukjent feil under generering.";

		if (setId) {
			await getFirestore()
				.collection("studySets")
				.doc(setId)
				.update({
					status: "error",
						lastError: errorMessage,
				})
				.catch((updateError) => {
					console.error("FAILED TO UPDATE ERROR STATUS:", updateError);
				});
		}

		return NextResponse.json(
				{ error: errorMessage },
			{ status: 500 },
		);
	}
}