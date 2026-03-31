import { NextRequest, NextResponse } from "next/server";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore, type Firestore, type WriteBatch } from "firebase-admin/firestore";
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
import { withRetry } from "@/lib/transientRetry";

export const runtime = "nodejs";
export const maxDuration = 60;

if (!getApps().length) {
	initializeApp({
		credential: cert(JSON.parse(process.env.FIREBASE_ADMIN_KEY!)),
		storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
	});
}

const MAX_FIRESTORE_BATCH_OPERATIONS = 400;

type ProcessLockResult =
	| { type: "locked"; setData: Record<string, unknown> }
	| { type: "busy" }
	| { type: "missing" }
	| { type: "missingData" };

function logProcessEvent(setId: string, stage: string, details?: Record<string, unknown>) {
	console.info("[process]", {
		setId,
		stage,
		...(details ?? {}),
	});
}

async function updateProcessState(setId: string, data: Record<string, unknown>) {
	await withRetry("process status update", () =>
		getFirestore().collection("studySets").doc(setId).update(data),
	);
}

async function acquireProcessingLock(
	db: Firestore,
	setId: string,
): Promise<ProcessLockResult> {
	return withRetry("process lock", async () =>
		db.runTransaction(async (transaction) => {
			const setRef = db.collection("studySets").doc(setId);
			const setSnap = await transaction.get(setRef);

			if (!setSnap.exists) {
				return { type: "missing" } satisfies ProcessLockResult;
			}

			const setData = setSnap.data();

			if (!setData) {
				return { type: "missingData" } satisfies ProcessLockResult;
			}

			if (setData.status === "processing") {
				return { type: "busy" } satisfies ProcessLockResult;
			}

			transaction.update(setRef, { status: "processing", lastError: null });

			return {
				type: "locked",
				setData: setData as Record<string, unknown>,
			} satisfies ProcessLockResult;
		}),
	);
}

async function commitInChunks<T>(
	db: Firestore,
	operationName: string,
	items: T[],
	applyOperation: (batch: WriteBatch, item: T) => void,
) {
	for (let index = 0; index < items.length; index += MAX_FIRESTORE_BATCH_OPERATIONS) {
		const slice = items.slice(index, index + MAX_FIRESTORE_BATCH_OPERATIONS);
		const batch = db.batch();

		slice.forEach((item) => applyOperation(batch, item));

		await withRetry(`${operationName} batch ${index / MAX_FIRESTORE_BATCH_OPERATIONS + 1}`, () =>
			batch.commit(),
		);
	}
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
			const requestStartedAt = Date.now();

		const setRef = db.collection("studySets").doc(setId);
			logProcessEvent(setId, "request_started");
			const lockResult = await acquireProcessingLock(db, setId);

			if (lockResult.type === "missing") {
				logProcessEvent(setId, "set_missing");
			return NextResponse.json(
					{ error: "Fant ikke studiesettet." },
				{ status: 404 },
			);
		}

			if (lockResult.type === "missingData") {
				logProcessEvent(setId, "set_missing_data");
			return NextResponse.json(
					{ error: "Mangler studiesettdata." },
				{ status: 500 },
			);
		}

			if (lockResult.type === "busy") {
				logProcessEvent(setId, "already_processing");
				return NextResponse.json(
						{ error: "Generering pågår allerede." },
					{ status: 409 },
				);
			}

			const setData = lockResult.setData;
			const storedFiles = getStoredStudySetFiles(setData);
			logProcessEvent(setId, "processing_locked", { fileCount: storedFiles.length });

			if (storedFiles.length === 0) {
				await updateProcessState(setId, {
				status: "error",
				lastError: "Studiesettet mangler filreferanse.",
			});
				logProcessEvent(setId, "missing_file_reference");

			return NextResponse.json(
					{ error: "Studiesettet mangler filreferanse." },
				{ status: 400 },
			);
		}
		let text = "";

		try {
				const extractedTexts: string[] = [];

				for (const [index, storedFile] of storedFiles.entries()) {
					const file = bucket.file(storedFile.filePath);
					const [buffer] = await withRetry(
						`process file download (${index + 1}/${storedFiles.length})`,
						() => file.download(),
					);
					const extractedText = await extractTextFromFileBuffer(buffer, storedFile.fileName);

					extractedTexts.push(`Kilde ${index + 1}: ${storedFile.fileName}\n${extractedText.trim()}`);
					logProcessEvent(setId, "file_extracted", {
						fileIndex: index + 1,
						fileCount: storedFiles.length,
						fileName: storedFile.fileName,
						extractedTextLength: extractedText.length,
					});
				}

				text = extractedTexts.join("\n\n").trim();
				logProcessEvent(setId, "text_extracted", {
					fileCount: storedFiles.length,
					extractedTextLength: text.length,
				});
			} catch (error) {
				const extractionError = getTextExtractionError(error);

					await updateProcessState(setId, { status: "error", lastError: extractionError.message });
					logProcessEvent(setId, "text_extraction_failed", {
						message: extractionError.message,
						status: extractionError.status,
						durationMs: Date.now() - requestStartedAt,
					});
			return NextResponse.json(
					{ error: extractionError.message },
					{ status: extractionError.status },
			);
		}

		if (!text || text.trim().length < 100) {
				await updateProcessState(setId, {
					status: "error",
						lastError: "Det ble hentet ut for lite tekst fra materialet.",
				});
				logProcessEvent(setId, "text_too_short", {
					extractedTextLength: text.trim().length,
					durationMs: Date.now() - requestStartedAt,
				});
			return NextResponse.json(
						{ error: "Det ble hentet ut for lite tekst fra materialet." },
				{ status: 400 },
			);
		}

			const chunks = groupChunksForCards(text);
			logProcessEvent(setId, "chunks_grouped", {
				chunkCount: chunks.length,
				extractedTextLength: text.length,
			});

		if (chunks.length === 0) {
				await updateProcessState(setId, {
				status: "error",
						lastError: "Fant ingen brukbare tekstavsnitt i materialet.",
			});
				logProcessEvent(setId, "no_usable_chunks", {
					extractedTextLength: text.length,
					durationMs: Date.now() - requestStartedAt,
				});
			return NextResponse.json(
						{ error: "Fant ingen brukbare tekstavsnitt i materialet." },
				{ status: 400 },
			);
		}

		const cardsCol = setRef.collection("cards");

			const existingCards = await withRetry("existing cards lookup", () => cardsCol.get());
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

			for (const [index, chunk] of chunks.entries()) {
				const chunkStartedAt = Date.now();
			const cards = await generateCardsFromChunk(chunk, feedbackProfile);
			allCards.push(...cards);
				logProcessEvent(setId, "chunk_generated", {
					chunkIndex: index + 1,
					chunkCount: chunks.length,
					chunkLength: chunk.length,
					generatedCardCount: cards.length,
					durationMs: Date.now() - chunkStartedAt,
				});
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
				await updateProcessState(setId, {
				status: "error",
				lastError:
					"Klarte ikke å lage brukbare flashcards fra teksten. Prøv igjen, eller last opp en fil med tydeligere sammenhengende tekst.",
			});
				logProcessEvent(setId, "no_cards_after_generation", {
					rawCardCount: allCards.length,
					dedupedCardCount: deduped.length,
					durationMs: Date.now() - requestStartedAt,
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
			logProcessEvent(setId, "cards_deduped", {
				rawCardCount: allCards.length,
				dedupedCardCount: deduped.length,
				droppedCardCount: allCards.length - deduped.length,
				existingCardCount: existingCards.docs.length,
			});

			await commitInChunks(db, "delete existing cards", existingCards.docs, (batch, cardDoc) => {
				batch.delete(cardDoc.ref);
			});

			await commitInChunks(db, "write generated cards", deduped, (batch, card) => {
				batch.set(cardsCol.doc(), {
					...card,
					createdAt: generatedAt,
				});
			});

			await updateProcessState(setId, {
			status: "ready",
			cardCount: deduped.length,
			extractedTextLength: text.length,
			feedbackProfile,
			feedbackProfileUpdatedAt: generatedAt,
			lastError: null,
		});
			logProcessEvent(setId, "completed", {
				cardCount: deduped.length,
				extractedTextLength: text.length,
				chunkCount: chunks.length,
				durationMs: Date.now() - requestStartedAt,
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
				logProcessEvent(setId, "failed", { errorMessage });
				await updateProcessState(setId, {
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