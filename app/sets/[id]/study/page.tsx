"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase";
import { fetchClientSession } from "@/lib/clientSession";
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
	userId?: string;
	title: string;
	subject: string;
	status: string;
};

type StudyOrder = "fixed" | "random";

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
	return null;
}

function getSingleSearchParam(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

function hashString(input: string) {
	let hash = 2166136261;

	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function getOrderedCards(cards: Card[], order: StudyOrder, seed: string | null) {
	if (order !== "random") {
		return cards;
	}

	const effectiveSeed = seed?.trim() || "default";

	return [...cards].sort((left, right) => {
		const leftWeight = hashString(`${effectiveSeed}:${left.id}`);
		const rightWeight = hashString(`${effectiveSeed}:${right.id}`);

		if (leftWeight !== rightWeight) {
			return leftWeight - rightWeight;
		}

		return left.id.localeCompare(right.id);
	});
}

export default function StudyModePage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
		searchParams: Promise<{ count?: string | string[]; order?: string | string[]; seed?: string | string[] }>;
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

	const requestedCount = getSingleSearchParam(resolvedSearchParams.count);
	const requestedOrder = getSingleSearchParam(resolvedSearchParams.order);
	const requestedSeed = getSingleSearchParam(resolvedSearchParams.seed);

	const parsedCount = Number.parseInt(requestedCount ?? "", 10);
	const studyOrder: StudyOrder = requestedOrder === "fixed" ? "fixed" : "random";

	const ensureSession = useCallback(async () => {
		try {
			const session = await fetchClientSession();

			if (session.unauthorized) {
				setLoadError("Du må logge inn på nytt.");
				setData(null);
				setCards([]);
				router.replace("/");
				return null;
			}

			if (session.error || !session.userId) {
				setLoadError(session.error || "Kunne ikke bekrefte innloggingen din.");
				setData(null);
				setCards([]);
				return null;
			}

			return session.userId;
		} catch (sessionError) {
			console.error(sessionError);
			setLoadError("Kunne ikke bekrefte innloggingen din.");
			setData(null);
			setCards([]);
			return null;
		}
	}, [router]);

	const loadSet = useCallback(async () => {
		setLoading(true);
		setLoadError(null);

		try {
			const sessionUserId = await ensureSession();

			if (!sessionUserId) {
				return;
			}

			const snap = await getDoc(doc(db, "studySets", id));

			if (!snap.exists()) {
				setData(null);
				setCards([]);
				return;
			}

			const studySetData = snap.data() as StudySet;

			if (!studySetData.userId || studySetData.userId !== sessionUserId) {
				setLoadError("Du har ikke tilgang til dette studiesettet.");
				setData(null);
				setCards([]);
				router.replace("/dashboard");
				return;
			}

			setData(studySetData);

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
	}, [ensureSession, id, router]);

	useEffect(() => {
		void loadSet();
	}, [loadSet]);

	const activeCards = useMemo(() => {
		const orderedCards = getOrderedCards(cards, studyOrder, requestedSeed ?? null);

		if (!Number.isFinite(parsedCount) || parsedCount <= 0) {
			return orderedCards;
		}

		return orderedCards.slice(0, Math.min(orderedCards.length, parsedCount));
	}, [cards, parsedCount, requestedSeed, studyOrder]);

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
				{feedbackText ? <p className="muted-text text-sm">{feedbackText}</p> : null}
				<div className="study-flip-card__actions">
					<button
						type="button"
						className="btn btn-secondary study-card-button w-full"
						onClick={() => setCurrentIndex((index) => Math.max(index - 1, 0))}
						disabled={isFirstCard}
					>
						Forrige
					</button>
					<button
						type="button"
						className="btn btn-primary study-card-button w-full"
						onClick={() => setCurrentIndex((index) => Math.min(index + 1, activeCards.length - 1))}
						disabled={isLastCard}
					>
						Neste
					</button>
					<button
						type="button"
						className={`btn study-card-button study-feedback-button w-full ${
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
						className={`btn study-card-button study-feedback-button w-full ${
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
			<div className="page-container study-page-container stack-lg">
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
							<span className="pill pill-neutral">
								{studyOrder === "random" ? "Tilfeldig rekkefølge" : "Fast rekkefølge"}
							</span>
						<span className={getDifficultyClass(currentCard.difficulty)}>
							{getDifficultyLabel(currentCard.difficulty)}
						</span>
					</div>
				</section>

				<section className="surface-panel study-surface-panel stack-lg">
						<div className={`study-flip-card ${flipped ? "study-flip-card--flipped" : ""}`}>
							<div className="study-flip-card__inner">
								<div className="study-flip-card__face study-flip-card__face--front">
									<button
										type="button"
										onClick={() => setFlipped((current) => !current)}
										className="study-flip-card__content"
									>
										<span className="pill pill-blue">Spørsmål</span>
										<span className="study-flip-card__body">
											<span className="text-2xl font-semibold leading-9">{currentCard.question}</span>
										</span>
									</button>
									{renderCardFooter()}
								</div>
								<div className="study-flip-card__face study-flip-card__face--back">
									<button
										type="button"
										onClick={() => setFlipped((current) => !current)}
										className="study-flip-card__content"
									>
										<span className="pill pill-green">Svar</span>
										<span className="study-flip-card__body">
											<span className="text-2xl font-semibold leading-9">{currentCard.answer}</span>
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