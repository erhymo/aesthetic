import path from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const client = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

PDFParse.setWorker(
	pathToFileURL(
		path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
	).href,
);

export type Flashcard = {
	question: string;
	answer: string;
	difficulty: "easy" | "medium" | "hard";
	sourceSnippet: string;
};

export type CardFeedback = "up" | "down" | null;

export type FeedbackSignalCard = {
	question: string;
	difficulty: Flashcard["difficulty"];
	feedback?: CardFeedback;
};

export type QuestionStyle =
	| "definition"
	| "reasoning"
	| "process"
	| "comparison"
	| "listing"
	| "detail";

export type FlashcardFeedbackProfile = {
	ratedCount: number;
	positiveCount: number;
	negativeCount: number;
	preferredQuestionStyles: QuestionStyle[];
	avoidedQuestionStyles: QuestionStyle[];
	preferredDifficulties: Flashcard["difficulty"][];
	avoidedDifficulties: Flashcard["difficulty"][];
};

export type DocumentSummary = {
	title: string;
	intro: string;
	bullets: string[];
	takeaway: string;
};

export async function parsePDF(buffer: Buffer) {
	const parser = new PDFParse({ data: buffer });
	try {
		const result = await parser.getText();
		return result.text;
	} finally {
		await parser.destroy();
	}
}

export async function parseDOCX(buffer: Buffer) {
	const result = await mammoth.extractRawText({ buffer });
	return result.value;
}

export async function extractTextFromFileBuffer(buffer: Buffer, rawFileName: string) {
	const fileName = rawFileName.toLowerCase();

	if (fileName.endsWith(".pdf")) {
		return parsePDF(buffer);
	}

	if (fileName.endsWith(".docx")) {
		return parseDOCX(buffer);
	}

	throw new Error("Unsupported file type");
}

export function chunkText(text: string, maxChars = 4000) {
	const cleaned = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();

	const parts: string[] = [];
	let start = 0;

	while (start < cleaned.length) {
		let end = start + maxChars;

		if (end >= cleaned.length) {
			parts.push(cleaned.slice(start).trim());
			break;
		}

		const lastBreak = cleaned.lastIndexOf("\n\n", end);
		if (lastBreak > start + 1000) {
			end = lastBreak;
		}

		parts.push(cleaned.slice(start, end).trim());
		start = end;
	}

	return parts.filter(Boolean);
}

function normalizeWhitespace(value: string) {
	return value.replace(/\s+/g, " ").trim();
}

function isFlashcardDifficulty(value: unknown): value is Flashcard["difficulty"] {
	return value === "easy" || value === "medium" || value === "hard";
}

function sanitizeSourceSnippet(sourceSnippet: string, chunk: string) {
	const normalizedSnippet = normalizeWhitespace(sourceSnippet).replace(
		/^["'“”‘’«»]+|["'“”‘’«»]+$/g,
		"",
	);
	const normalizedChunk = normalizeWhitespace(chunk);

	if (normalizedSnippet.length < 20 || normalizedSnippet.length > 320) {
		return null;
	}

	if (!normalizedChunk.includes(normalizedSnippet)) {
		return null;
	}

	return normalizedSnippet;
}

function normalizeGeneratedFlashcards(cards: unknown[], chunk: string): Flashcard[] {
	return cards.flatMap((card) => {
		if (!card || typeof card !== "object") {
			return [];
		}

		const rawCard = card as Record<string, unknown>;
		const question =
			typeof rawCard.question === "string" ? normalizeWhitespace(rawCard.question) : "";
		const answer =
			typeof rawCard.answer === "string" ? normalizeWhitespace(rawCard.answer) : "";
		const sourceSnippet =
			typeof rawCard.sourceSnippet === "string"
				? sanitizeSourceSnippet(rawCard.sourceSnippet, chunk)
				: null;

		if (!question || !answer || !isFlashcardDifficulty(rawCard.difficulty) || !sourceSnippet) {
			return [];
		}

		return [
			{
				question,
				answer,
				difficulty: rawCard.difficulty,
				sourceSnippet,
			},
		];
	});
}

function detectQuestionStyle(question: string): QuestionStyle {
	const normalized = question.trim().toLowerCase();

	if (
		normalized.startsWith("hva er") ||
		normalized.startsWith("hvem er") ||
		normalized.startsWith("what is") ||
		normalized.startsWith("who is") ||
		normalized.startsWith("definer") ||
		normalized.startsWith("define")
	) {
		return "definition";
	}

	if (
		normalized.startsWith("hvorfor") ||
		normalized.startsWith("why") ||
		normalized.includes("årsak") ||
		normalized.includes("grunn")
	) {
		return "reasoning";
	}

	if (
		normalized.startsWith("hvordan") ||
		normalized.startsWith("how") ||
		normalized.startsWith("forklar hvordan") ||
		normalized.startsWith("beskriv hvordan")
	) {
		return "process";
	}

	if (
		normalized.startsWith("sammenlign") ||
		normalized.startsWith("compare") ||
		normalized.includes("forskjell") ||
		normalized.includes("likhet")
	) {
		return "comparison";
	}

	if (
		normalized.startsWith("hvilke") ||
		normalized.startsWith("nevn") ||
		normalized.startsWith("list") ||
		normalized.startsWith("navngi") ||
		normalized.startsWith("name")
	) {
		return "listing";
	}

	return "detail";
}

function getQuestionStyleLabel(style: QuestionStyle) {
	if (style === "definition") return "definisjonskort";
	if (style === "reasoning") return "årsaks-/hvorfor-spørsmål";
	if (style === "process") return "hvordan-/prosess-spørsmål";
	if (style === "comparison") return "sammenligningsspørsmål";
	if (style === "listing") return "liste-/oppramsingsspørsmål";
	return "konkrete detaljspørsmål";
}

function rankEntries<T extends string>(scores: Map<T, number>, predicate: (score: number) => boolean) {
	return Array.from(scores.entries())
		.filter(([, score]) => predicate(score))
		.sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]))
		.map(([key]) => key)
		.slice(0, 2);
}

export function buildFeedbackProfile(
	cards: FeedbackSignalCard[],
): FlashcardFeedbackProfile | null {
	const styleScores = new Map<QuestionStyle, number>();
	const difficultyScores = new Map<Flashcard["difficulty"], number>();
	let positiveCount = 0;
	let negativeCount = 0;

	for (const card of cards) {
		if (card.feedback !== "up" && card.feedback !== "down") {
			continue;
		}

		const score = card.feedback === "up" ? 1 : -1;
		const style = detectQuestionStyle(card.question);

		styleScores.set(style, (styleScores.get(style) ?? 0) + score);
		difficultyScores.set(
			card.difficulty,
			(difficultyScores.get(card.difficulty) ?? 0) + score,
		);

		if (score > 0) {
			positiveCount += 1;
		} else {
			negativeCount += 1;
		}
	}

	const ratedCount = positiveCount + negativeCount;

	if (ratedCount === 0) {
		return null;
	}

	return {
		ratedCount,
		positiveCount,
		negativeCount,
		preferredQuestionStyles: rankEntries(styleScores, (score) => score > 0),
		avoidedQuestionStyles: rankEntries(styleScores, (score) => score < 0),
		preferredDifficulties: rankEntries(difficultyScores, (score) => score > 0),
		avoidedDifficulties: rankEntries(difficultyScores, (score) => score < 0),
	};
}

function buildFeedbackGuidance(profile?: FlashcardFeedbackProfile | null) {
	if (!profile || profile.ratedCount === 0) {
		return "";
	}

	const lines = [
		"Tidligere feedback for dette studiesettet:",
		`- Likte kort: ${profile.positiveCount}`,
		`- Liker ikke kort: ${profile.negativeCount}`,
	];

	if (profile.preferredQuestionStyles.length > 0) {
		lines.push(
			`- Prioriter gjerne ${profile.preferredQuestionStyles.map(getQuestionStyleLabel).join(", ")}.`,
		);
	}

	if (profile.avoidedQuestionStyles.length > 0) {
		lines.push(
			`- Vær mer forsiktig med ${profile.avoidedQuestionStyles.map(getQuestionStyleLabel).join(", ")}.`,
		);
	}

	if (profile.preferredDifficulties.length > 0) {
		lines.push(
			`- Prioriter helst vanskelighetsgrad: ${profile.preferredDifficulties.join(", ")}.`,
		);
	}

	if (profile.avoidedDifficulties.length > 0) {
		lines.push(
			`- Unngå å overvekte vanskelighetsgrad: ${profile.avoidedDifficulties.join(", ")}.`,
		);
	}

	lines.push(
		"Bruk feedbacken kun som signal for format, fokus og vanskelighetsnivå. Den er ikke en kilde til fakta.",
		"Hver opplysning i kortene må fortsatt være direkte støttet av teksten under.",
	);

	return `${lines.join("\n")}\n\n`;
}

function groupChunksForSummary(text: string) {
	const chunks = chunkText(text, 4500);

	if (chunks.length <= 6) {
		return chunks;
	}

	const groupSize = Math.ceil(chunks.length / 6);
	const grouped: string[] = [];

	for (let index = 0; index < chunks.length; index += groupSize) {
		grouped.push(chunks.slice(index, index + groupSize).join("\n\n"));
	}

	return grouped;
}

async function summarizeSegment(segment: string) {
	const response = await client.responses.create({
		model: "gpt-5.1",
		input: [
			{
				role: "system",
				content: [
					{
						type: "input_text",
						text:
							"Du er en nøktern lærerassistent. Oppsummer kun det som faktisk står i teksten du får. " +
							"Ikke bruk web, ikke legg til forklaringer fra egen kunnskap, og ikke gjett.",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text:
							"Lag 2-4 korte punkt fra teksten under. " +
							"Hvert punkt skal være konkret, enkelt å forstå, og tydelig forankret i teksten.\n\n" +
							"Tekst:\n" +
							segment,
					},
				],
			},
		],
		text: {
			format: {
				type: "json_schema",
				name: "summary_segment",
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						bullets: {
							type: "array",
							items: { type: "string" },
						},
					},
					required: ["bullets"],
				},
			},
		},
	});

	const parsed = JSON.parse(response.output_text) as { bullets: string[] };

	return parsed.bullets
		.map((bullet) => bullet.trim())
		.filter(Boolean)
		.slice(0, 4);
}

export async function generateCardsFromChunk(
	chunk: string,
	feedbackProfile?: FlashcardFeedbackProfile | null,
): Promise<Flashcard[]> {
	const feedbackGuidance = buildFeedbackGuidance(feedbackProfile);

	const response = await client.responses.create({
		model: "gpt-5.1",
		input: [
			{
				role: "system",
				content: [
					{
						type: "input_text",
						text:
							"Du er en lærer som lager svært gode flashcards for prøveforberedelse. " +
							"Lag bare kort basert på innhold i teksten. " +
							"Velg det som mest sannsynlig er viktig til prøve. " +
							"Kortene skal være klare, korte og entydige. " +
							"Hvis du får tidligere feedback, skal den kun brukes til å prioritere type spørsmål og vanskelighetsgrad. " +
							"Du må aldri bruke feedback som kilde til fakta eller trekke inn informasjon som ikke står i teksten.",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text:
							"Lag 8-15 flashcards fra teksten under.\n\n" +
							"Krav:\n" +
							"- korte spørsmål\n" +
							"- presise svar\n" +
							"- bare viktige ting\n" +
							'- difficulty må være "easy", "medium" eller "hard"\n' +
							"- sourceSnippet må være et kort, eksakt utdrag kopiert fra teksten\n" +
							"- sourceSnippet skal være 1-2 setninger eller et kort sitat på maks 280 tegn\n" +
							"- sourceSnippet må bruke original ordlyd fra teksten, ikke omskriving eller egne formuleringer\n" +
							"- ikke bruk kunnskap utenfor teksten\n" +
							"- hvis teksten ikke støtter et kort tydelig, skal kortet ikke lages\n\n" +
							feedbackGuidance +
							"Tekst:\n" +
							chunk,
					},
				],
			},
		],
		text: {
			format: {
				type: "json_schema",
				name: "flashcards",
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						cards: {
							type: "array",
							items: {
								type: "object",
								additionalProperties: false,
								properties: {
									question: { type: "string" },
									answer: { type: "string" },
									difficulty: {
										type: "string",
										enum: ["easy", "medium", "hard"],
									},
										sourceSnippet: { type: "string" },
								},
									required: ["question", "answer", "difficulty", "sourceSnippet"],
							},
						},
					},
					required: ["cards"],
				},
			},
		},
	});

	const parsed = JSON.parse(response.output_text) as { cards?: unknown };
	return normalizeGeneratedFlashcards(Array.isArray(parsed.cards) ? parsed.cards : [], chunk);
}

export async function generateSummaryFromText(text: string): Promise<DocumentSummary> {
	const summarySegments = groupChunksForSummary(text);
	const segmentBullets: string[] = [];

	for (const segment of summarySegments) {
		const bullets = await summarizeSegment(segment);
		segmentBullets.push(...bullets);
	}

	const dedupedBullets = Array.from(
		new Set(segmentBullets.map((bullet) => bullet.replace(/\s+/g, " ").trim())),
	).slice(0, 10);

	const response = await client.responses.create({
		model: "gpt-5.1",
		input: [
			{
				role: "system",
				content: [
					{
						type: "input_text",
						text:
							"Du er en nøktern lærerassistent. Lag en kort oppsummering kun fra punktene du får. " +
							"Ikke bruk annen kunnskap, ikke fyll inn hull, og ikke skriv noe som ikke støttes av punktene.",
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "input_text",
						text:
							"Lag en kort norsk oppsummering med disse feltene:\n" +
							"- title: en kort overskrift\n" +
							"- intro: 1-2 setninger\n" +
							"- bullets: 3-5 korte hovedpunkter\n" +
							"- takeaway: 1 kort huskeregel\n\n" +
							"Kildepunkter:\n- " +
							dedupedBullets.join("\n- "),
					},
				],
			},
		],
		text: {
			format: {
				type: "json_schema",
				name: "document_summary",
				schema: {
					type: "object",
					additionalProperties: false,
					properties: {
						title: { type: "string" },
						intro: { type: "string" },
						bullets: {
							type: "array",
							items: { type: "string" },
						},
						takeaway: { type: "string" },
					},
					required: ["title", "intro", "bullets", "takeaway"],
				},
			},
		},
	});

	const parsed = JSON.parse(response.output_text) as DocumentSummary;

	return {
		title: parsed.title.trim(),
		intro: parsed.intro.trim(),
		bullets: parsed.bullets.map((bullet) => bullet.trim()).filter(Boolean).slice(0, 5),
		takeaway: parsed.takeaway.trim(),
	};
}

export const generateCards = generateCardsFromChunk;
