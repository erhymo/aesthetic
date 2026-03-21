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

export async function generateCardsFromChunk(chunk: string): Promise<Flashcard[]> {
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
							"Kortene skal være klare, korte og entydige.",
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
							'- difficulty må være "easy", "medium" eller "hard"\n\n' +
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
								},
								required: ["question", "answer", "difficulty"],
							},
						},
					},
					required: ["cards"],
				},
			},
		},
	});

	const parsed = JSON.parse(response.output_text) as { cards: Flashcard[] };
	return parsed.cards;
}

export const generateCards = generateCardsFromChunk;
