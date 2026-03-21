"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	orderBy,
	query,
	updateDoc,
} from "firebase/firestore";

type CardFeedback = "up" | "down" | null;

type Card = {
	id: string;
	question: string;
	answer: string;
	difficulty: "easy" | "medium" | "hard";
	feedback?: CardFeedback;
	feedbackUpdatedAt?: string | null;
};

type StudySet = {
	title: string;
	subject: string;
	status: string;
};

function getDifficultyLabel(difficulty: Card["difficulty"]) {
	if (difficulty === "easy") return "Lett";
	if (difficulty === "hard") return "Vanskelig";
	return "Middels";
}

function getDifficultyClass(difficulty: Card["difficulty"]) {
	if (difficulty === "easy") return "pill pill-green";
	if (difficulty === "hard") return "pill pill-rose";
	return "pill pill-amber";
}

function getFeedbackText(feedback: CardFeedback) {
	if (feedback === "up") return "Markert som nyttig 👍";
	if (feedback === "down") return "Markert som mindre nyttig 👎";
	return "Marker kortet med 👍 eller 👎.";
}

export default function StudyModePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ count?: string | string[] }>;
}) {
	const { id } = use(params);
	const resolvedSearchParams = use(searchParams);
	const router = useRouter();
	const [data, setData] = useState<StudySet | null>(null);
	const [cards, setCards] = useState<Card[]>([]);
	const [currentIndex, setCurrentIndex] = useState(0);
	const [flipped, setFlipped] = useState(false);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [feedbackError, setFeedbackError] = useState<string | null>(null);
	const [savingFeedback, setSavingFeedback] = useState(false);

	const requestedCount = Array.isArray(resolvedSearchParams.count)
		? resolvedSearchParams.count[0]
		: resolvedSearchParams.count;

	const parsedCount = Number.parseInt(requestedCount ?? "", 10);

	const loadSet = useCallback(async () => {
		setLoading(true);
		setLoadError(null);

		try {
			const snap = await getDoc(doc(db, "studySets", id));

			if (!snap.exists()) {
				setData(null);
				setCards([]);
				return;
			}

			setData(snap.data() as StudySet);

			const cardsSnap = await getDocs(
				query(collection(db, "studySets", id, "cards"), orderBy("createdAt", "asc")),
			);

			const loadedCards = cardsSnap.docs.map((cardDoc) => ({
				id: cardDoc.id,
				...(cardDoc.data() as Omit<Card, "id">),
			}));

			setCards(loadedCards);
		} catch (loadError) {
			console.error(loadError);
			setLoadError("Kunne ikke laste studiemodus.");
			setData(null);
			setCards([]);
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		void loadSet();
	}, [loadSet]);

	const activeCards = useMemo(() => {
		if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
			return cards;
		}

		return cards.slice(0, Math.min(cards.length, parsedCount));
	}, [cards, parsedCount]);

	useEffect(() => {
		setCurrentIndex((previousIndex) => {
			if (activeCards.length === 0) return 0;
			return Math.min(previousIndex, activeCards.length - 1);
		});
	}, [activeCards.length]);

	useEffect(() => {
		setFlipped(false);
		setFeedbackError(null);
	}, [currentIndex]);

	async function handleFeedback(nextFeedback: Exclude<CardFeedback, null>) {
		const currentCard = activeCards[currentIndex];

		if (!currentCard || savingFeedback) {
			return;
		}

		const resolvedFeedback: CardFeedback =
			currentCard.feedback === nextFeedback ? null : nextFeedback;
		const feedbackUpdatedAt = new Date().toISOString();

		setSavingFeedback(true);
		setFeedbackError(null);
		setCards((previousCards) =>
			previousCards.map((card) =>
				card.id === currentCard.id
					? {
						...card,
						feedback: resolvedFeedback,
						feedbackUpdatedAt,
					}
					: card,
			),
		);

		try {
			await updateDoc(doc(db, "studySets", id, "cards", currentCard.id), {
				feedback: resolvedFeedback,
				feedbackUpdatedAt,
			});
		} catch (feedbackError) {
			console.error(feedbackError);
			setCards((previousCards) =>
				previousCards.map((card) =>
					card.id === currentCard.id
						? {
							...card,
							feedback: currentCard.feedback ?? null,
							feedbackUpdatedAt: currentCard.feedbackUpdatedAt ?? null,
						}
						: card,
				),
			);
			setFeedbackError("Kunne ikke lagre feedback på kortet.");
		} finally {
			setSavingFeedback(false);
		}
	}

	if (loading) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-5xl">
					<div className="empty-panel">Laster studiemodus...</div>
				</div>
			</main>
		);
	}

	if (loadError) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-5xl">
					<div className="empty-panel stack-sm">
						<p>{loadError}</p>
						<button className="btn btn-secondary w-full sm:w-auto mx-auto" onClick={() => router.push(`/sets/${id}`)}>
							Tilbake til studiesett
						</button>
					</div>
				</div>
			</main>
		);
	}

	if (!data || activeCards.length === 0) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-5xl">
					<div className="empty-panel stack-sm">
						<h1 className="section-title">Ingen kort å studere ennå</h1>
						<button className="btn btn-primary w-full sm:w-auto mx-auto" onClick={() => router.push(`/sets/${id}`)}>
							Tilbake til studiesett
						</button>
					</div>
				</div>
			</main>
		);
	}

	const currentCard = activeCards[currentIndex];
	const feedbackText = getFeedbackText(currentCard.feedback ?? null);
	const isFirstCard = currentIndex === 0;
	const isLastCard = currentIndex >= activeCards.length - 1;

	function renderCardFooter() {
		return (
			<div className="study-flip-card__footer">
				<p className="muted-text text-sm">{feedbackText}</p>
				<div className="study-flip-card__actions">
					<button
						type="button"
						className="btn btn-secondary w-full"
						onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
						disabled={isFirstCard}
					>
						Forrige
					</button>
					<button
						type="button"
						className="btn btn-primary w-full"
						onClick={() => setCurrentIndex((index) => Math.min(index + 1, activeCards.length - 1))}
						disabled={isLastCard}
					>
						Neste
					</button>
					<button
						type="button"
						className={`btn w-full text-lg ${
							currentCard.feedback === "up"
								? "border-emerald-400/40 bg-emerald-500/15 text-emerald-100"
								: "btn-secondary"
						}`}
						onClick={() => void handleFeedback("up")}
						disabled={savingFeedback}
						aria-pressed={currentCard.feedback === "up"}
					>
						<span aria-hidden="true">👍</span>
						Nyttig
					</button>
					<button
						type="button"
						className={`btn w-full text-lg ${
							currentCard.feedback === "down"
								? "border-rose-400/40 bg-rose-500/15 text-rose-100"
								: "btn-secondary"
						}`}
						onClick={() => void handleFeedback("down")}
						disabled={savingFeedback}
						aria-pressed={currentCard.feedback === "down"}
					>
						<span aria-hidden="true">👎</span>
						Mindre nyttig
					</button>
				</div>
			</div>
		);
	}

	return (
		<main className="page-shell">
			<div className="page-container max-w-5xl stack-lg">
				<section className="hero-panel stack-lg">
					<div className="topbar">
						<div className="stack-sm">
							<div className="brand-mark">
								<span className="brand-dot" />
								Studiemodus
							</div>
							<h1 className="section-title">{data.title}</h1>
							<p className="lead-text">
								Ett kort om gangen. Trykk for å snu.
							</p>
						</div>

						<button className="btn btn-secondary w-full sm:w-auto" onClick={() => router.push(`/sets/${id}`)}>
							Tilbake til studiesett
						</button>
					</div>

					<div className="row-wrap">
						<span className="pill pill-neutral">{data.subject}</span>
						<span className="pill pill-blue">
							Kort {currentIndex + 1} av {activeCards.length}
						</span>
						<span className={getDifficultyClass(currentCard.difficulty)}>
							{getDifficultyLabel(currentCard.difficulty)}
						</span>
					</div>
				</section>

				<section className="surface-panel stack-lg">
						<div className={`study-flip-card ${flipped ? "study-flip-card--flipped" : ""}`}>
							<div className="study-flip-card__inner">
								<div className="study-flip-card__face study-flip-card__face--front">
									<button
										type="button"
										onClick={() => setFlipped((current) => !current)}
										className="study-flip-card__content"
									>
										<span className="pill pill-blue">Spørsmål</span>
										<span className="text-2xl font-semibold leading-9">{currentCard.question}</span>
										<span className="muted-text text-sm">Trykk for svar.</span>
									</button>
									{renderCardFooter()}
								</div>
								<div className="study-flip-card__face study-flip-card__face--back">
									<button
										type="button"
										onClick={() => setFlipped((current) => !current)}
										className="study-flip-card__content"
									>
										<span className="flex w-full flex-col gap-4 text-left">
											<span className="pill pill-green">Svar</span>
											<span className="text-2xl font-semibold leading-9">{currentCard.answer}</span>
											<span className="muted-text text-sm">Trykk for spørsmål.</span>
										</span>
									</button>
									{renderCardFooter()}
								</div>
							</div>
						</div>

						{feedbackError ? (
							<div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
								{feedbackError}
							</div>
						) : null}
				</section>
			</div>
		</main>
	);
}