"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { getApiResponseErrorMessage, parseApiJson } from "@/lib/apiResponse";
import { fetchClientSession } from "@/lib/clientSession";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	orderBy,
	query,
} from "firebase/firestore";
import { useRouter } from "next/navigation";

type Card = {
	id: string;
	question: string;
	answer: string;
	difficulty: "easy" | "medium" | "hard";
};

type StudySet = {
	userId?: string;
	title: string;
	subject: string;
	status: string;
	cardCount?: number;
	extractedTextLength?: number;
	lastError?: string | null;
};

type StudyOrder = "fixed" | "random";

function getStatusClass(status: string) {
	if (status === "error") return "pill pill-rose";
	if (status === "completed" || status === "ready") return "pill pill-green";
	if (status === "processing") return "pill pill-amber";
	return "pill pill-blue";
}

function getStatusLabel(status: string) {
	if (status === "error") return "Feilet";
	if (status === "ready" || status === "completed") return "Klar";
	if (status === "processing") return "Genererer";
	if (status === "uploaded") return "Lastet opp";
	return status;
}

function getDifficultyClass(difficulty: Card["difficulty"]) {
	if (difficulty === "easy") return "pill pill-green";
	if (difficulty === "hard") return "pill pill-rose";
	return "pill pill-amber";
}

function getDifficultyLabel(difficulty: Card["difficulty"]) {
	if (difficulty === "easy") return "Lett";
	if (difficulty === "hard") return "Vanskelig";
	return "Middels";
}

function getCardCountOptions(cardCount: number) {
	if (cardCount <= 0) return [];

	return Array.from(new Set([5, 10, 15, 20, cardCount].filter((count) => count <= cardCount)))
		.sort((left, right) => left - right);
}
export default function StudySetPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const router = useRouter();
	const [data, setData] = useState<StudySet | null>(null);
	const [cards, setCards] = useState<Card[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [processing, setProcessing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [selectedCardCount, setSelectedCardCount] = useState(0);
	const [studyOrder, setStudyOrder] = useState<StudyOrder>("random");

	const ensureSession = useCallback(async () => {
		try {
			const session = await fetchClientSession();

			if (session.unauthorized) {
				setError("Du må logge inn på nytt.");
				setData(null);
				setCards([]);
				router.replace("/");
				return null;
			}

			if (session.error || !session.userId) {
				setError(session.error || "Kunne ikke bekrefte innloggingen din.");
				setData(null);
				setCards([]);
				return null;
			}

			return session.userId;
		} catch (sessionError) {
			console.error(sessionError);
			setError("Kunne ikke bekrefte innloggingen din.");
			setData(null);
			setCards([]);
			return null;
		}
	}, [router]);

	const loadSet = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const sessionUserId = await ensureSession();

			if (!sessionUserId) {
				return null;
			}

			const snap = await getDoc(doc(db, "studySets", id));

			if (!snap.exists()) {
				setData(null);
				setCards([]);
				return null;
			}

			const studySetData = snap.data() as StudySet;

			if (!studySetData.userId || studySetData.userId !== sessionUserId) {
				setError("Du har ikke tilgang til dette studiesettet.");
				setData(null);
				setCards([]);
				router.replace("/dashboard");
				return null;
			}

			setData(studySetData);

			const cardsSnap = await getDocs(
				query(collection(db, "studySets", id, "cards"), orderBy("createdAt", "asc")),
			);

			const loadedCards = cardsSnap.docs.map((d) => ({
				id: d.id,
				...(d.data() as Omit<Card, "id">),
			}));

			setCards(loadedCards);
			return studySetData;
		} catch (error) {
			console.error(error);
			setError("Kunne ikke laste studiesettet.");
			setData(null);
			setCards([]);
			return null;
		} finally {
			setLoading(false);
		}
	}, [ensureSession, id, router]);

	useEffect(() => {
		void loadSet();
	}, [loadSet]);

	useEffect(() => {
		const options = getCardCountOptions(cards.length);

		if (options.length === 0) {
			setSelectedCardCount(0);
			return;
		}

		setSelectedCardCount((currentCount) => {
			if (options.includes(currentCount)) {
				return currentCount;
			}

			return options.includes(10) ? 10 : options[options.length - 1];
		});
	}, [cards.length]);

	async function handleGenerate() {
		if (processing || data?.status === "processing") {
			return;
		}

		try {
			setProcessing(true);

			const sessionUserId = await ensureSession();

			if (!sessionUserId) {
				return;
			}

			const res = await fetch("/api/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ setId: id }),
			});

			const rawBody = await res.text();
				const json = parseApiJson<{
					error?: string;
					cardCount?: number;
				}>(rawBody);
				const responseError = getApiResponseErrorMessage(
					rawBody,
					`Generering feilet (${res.status}).`,
				);

			if (!res.ok) {
				if (res.status === 401) {
					alert("Økten din har gått ut. Logg inn på nytt.");
					router.replace("/");
					return;
				}

				if (res.status === 403) {
					alert("Du har ikke tilgang til dette studiesettet.");
					router.replace("/dashboard");
					return;
				}

				const refreshedSet = await loadSet();
				alert(
					refreshedSet?.lastError?.trim() ||
						responseError ||
						`Generering feilet (${res.status}).`,
				);
				return;
			}

			const refreshedSet = await loadSet();
			const generatedCardCount =
				typeof json?.cardCount === "number" ? json.cardCount : refreshedSet?.cardCount ?? 0;

			// Generate summary automatically
			try {
				await fetch("/api/summary", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ setId: id }),
				});
			} catch (summaryErr) {
				console.error("Failed to generate summary automatically:", summaryErr);
			}

			alert(`Ferdig. Genererte ${generatedCardCount} flashcards og en oppsummering.`);
		} catch (err) {
			console.error(err);
			await loadSet();
			alert("Feil under generering. Prøv igjen om litt.");
		} finally {
			setProcessing(false);
		}
	}

	async function handleDelete() {
		if (deleting) {
			return;
		}

		const confirmed = window.confirm(
			`Er du sikker på at du vil slette studiesettet “${data?.title ?? "dette studiesettet"}”? Dette kan ikke angres.`,
		);

		if (!confirmed) {
			return;
		}

		try {
			setDeleting(true);

			const sessionUserId = await ensureSession();

			if (!sessionUserId) {
				return;
			}

			const res = await fetch("/api/delete-study-set", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ setId: id }),
			});

			const rawBody = await res.text();
				const parsed = parseApiJson<{ error?: string }>(rawBody);
				const responseError = getApiResponseErrorMessage(
					rawBody,
					"Kunne ikke slette studiesettet.",
				);

			if (!res.ok) {
					if (res.status === 401) {
						alert("Økten din har gått ut. Logg inn på nytt.");
						router.replace("/");
						return;
					}

					if (res.status === 403) {
						alert("Du har ikke tilgang til dette studiesettet.");
						router.replace("/dashboard");
						return;
					}

					alert(parsed?.error?.trim() || responseError);
				return;
			}

			router.push("/dashboard");
			router.refresh();
		} catch (deleteError) {
			console.error(deleteError);
			alert("Noe gikk galt under sletting. Prøv igjen om litt.");
		} finally {
			setDeleting(false);
		}
	}

	if (loading) return <main className="page-shell"><div className="page-container"><div className="empty-panel">Laster...</div></div></main>;
	if (error) return <main className="page-shell"><div className="page-container"><div className="empty-panel">{error}</div></div></main>;
	if (!data) return <main className="page-shell"><div className="page-container"><div className="empty-panel">Fant ikke studiesettet.</div></div></main>;
	const isGenerating = processing || data.status === "processing";
	const countOptions = getCardCountOptions(cards.length);
	const previewCards = cards.slice(0, 6);
	const selectedCount = Math.min(selectedCardCount || cards.length, cards.length);

	function handleStartStudy() {
		if (isGenerating || cards.length === 0 || selectedCount === 0) {
			return;
		}

		const params = new URLSearchParams({
			count: String(selectedCount),
			order: studyOrder,
		});

		if (studyOrder === "random") {
			params.set(
				"seed",
				globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			);
		}

		router.push(`/sets/${id}/study?${params.toString()}`);
	}

	return (
		<main className="page-shell">
			<div className="page-container max-w-5xl stack-lg">
				<section className="hero-panel stack-lg">
					<div className="topbar">
						<div className="stack-sm">
							<div className="brand-mark">
								<span className="brand-dot" />
								Studiesett
							</div>
							<h1 className="section-title">{data.title}</h1>
							<p className="lead-text">
									Bruk denne siden som kontrollsenter: generer kort, velg antall og gå videre til roligere studiemodus.
							</p>
						</div>

						<div className="row-wrap">
								<Link href="/dashboard" className="btn btn-secondary w-full sm:w-auto">
									Til dashboard
								</Link>
								<button
									type="button"
									onClick={() => void handleDelete()}
									disabled={deleting}
									className="btn btn-danger w-full sm:w-auto"
								>
									{deleting ? "Sletter..." : "Slett studiesett"}
								</button>
							<button
								onClick={handleGenerate}
									disabled={isGenerating || deleting}
									className="btn btn-primary w-full sm:w-auto"
							>
								{isGenerating ? "Genererer..." : "Generer flashcards"}
							</button>
						</div>
					</div>

					<div className="row-wrap">
						<span className="pill pill-neutral">Fag: {data.subject}</span>
							<span className={getStatusClass(data.status)}>
								Status: {getStatusLabel(data.status)}
							</span>
							<span className="pill pill-blue">{cards.length} kort klare</span>
					</div>

						{data.lastError ? (
							<div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 p-4 text-rose-100">
								<p className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-200/90">
									Siste feil
								</p>
								<p className="mt-2 text-sm leading-6 text-rose-100/90">{data.lastError}</p>
							</div>
						) : null}

					<div className="stats-grid">
						<div className="stat-card">
							<span className="stat-label">Cards</span>
							<span className="stat-value">{cards.length}</span>
						</div>
						<div className="stat-card">
							<span className="stat-label">Generering</span>
							<span className="stat-value">
								{isGenerating ? "Pågår" : data.status === "error" ? "Feilet" : "Klar"}
							</span>
						</div>
						<div className="stat-card">
								<span className="stat-label">Kildetekst</span>
								<span className="stat-value">
									{data.extractedTextLength ? `${data.extractedTextLength} tegn` : "Ikke klar"}
								</span>
						</div>
					</div>
				</section>

					<section className="grid gap-4 lg:grid-cols-2">
						<div className="surface-panel stack-md">
							<div className="stack-sm">
								<div className="brand-mark">
									<span className="brand-dot" />
									Start
								</div>
								<h2 className="text-2xl font-semibold">Studer ett kort om gangen</h2>
								<p className="muted-text leading-7">
									Velg hvor mange kort du vil ta nå. På mobil og iPad kan du trykke på selve kortet for å snu det og gi tommel opp eller ned underveis.
								</p>
							</div>

							{cards.length === 0 ? (
								<div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200">
									Generer flashcards først for å aktivere studiemodusen.
								</div>
							) : (
								<>
									<div className="input-group max-w-xs">
										<label className="input-label" htmlFor="card-count">
											Antall kort
										</label>
										<select
											id="card-count"
											className="input-field"
											value={selectedCardCount}
											onChange={(event) => setSelectedCardCount(Number(event.target.value))}
										>
											{countOptions.map((count) => (
												<option key={count} value={count}>
													{count} kort
												</option>
											))}
										</select>
									</div>

								<div className="input-group max-w-md">
									<label className="input-label">Rekkefølge</label>
									<div className="row-wrap">
										<button
											type="button"
											onClick={() => setStudyOrder("random")}
											className={studyOrder === "random" ? "btn btn-primary" : "btn btn-secondary"}
										>
											Tilfeldig rekkefølge
										</button>
										<button
											type="button"
											onClick={() => setStudyOrder("fixed")}
											className={studyOrder === "fixed" ? "btn btn-primary" : "btn btn-secondary"}
										>
											Fast rekkefølge
										</button>
									</div>
									<p className="muted-text text-sm">
										Tilfeldig stokker kortene for denne økten. Fast følger original rekkefølge.
									</p>
								</div>

									<div className="row-wrap">
										<button
											type="button"
											onClick={handleStartStudy}
											disabled={isGenerating}
											className="btn btn-primary w-full sm:w-auto"
										>
										Start med {selectedCount} kort
										</button>
									</div>
								</>
							)}
						</div>

						<div className="surface-panel stack-md">
							<div className="stack-sm">
								<div className="brand-mark">
									<span className="brand-dot" />
									Kort oppsummert
								</div>
								<h2 className="text-2xl font-semibold">Egen oppsummeringsmodus</h2>
								<p className="muted-text leading-7">
									Navigasjonen er klar. I neste steg bygger jeg den faktiske oppsummeringen med streng kildekontroll fra materialet ditt.
								</p>
							</div>

							<div className="row-wrap">
								<Link href={`/sets/${id}/summary`} className="btn btn-secondary w-full sm:w-auto">
									Åpne Kort oppsummert
								</Link>
							</div>
							<p className="muted-text text-sm">
								Alt innhold i denne modusen skal komme fra opplastet tekst, ikke fra web.
							</p>
						</div>
					</section>

					<section className="stack-md">
						<div className="topbar">
							<h2 className="section-title text-2xl">Kortoversikt</h2>
							<span className="pill pill-neutral">{cards.length} kort</span>
						</div>

						{previewCards.length === 0 ? (
							<div className="empty-panel">
								<h3 className="text-xl font-semibold">Ingen flashcards ennå</h3>
								<p className="muted-text mt-2">
									Trykk på «Generer flashcards» for å fylle settet med spørsmål og svar.
								</p>
							</div>
						) : (
							<>
								<div className="card-grid">
									{previewCards.map((card) => (
										<div key={card.id} className="card-item stack-sm">
											<div className="row-wrap">
												<span className={getDifficultyClass(card.difficulty)}>
													{getDifficultyLabel(card.difficulty)}
												</span>
											</div>
											<h3 className="text-lg font-semibold leading-7">{card.question}</h3>
											<p className="muted-text text-sm">
												Svar vises i studiemodus for en roligere flyt.
											</p>
										</div>
									))}
								</div>
								{cards.length > previewCards.length ? (
									<p className="muted-text text-sm">
										Viser de første {previewCards.length} kortene her. Resten åpnes fra studiemodus.
									</p>
								) : null}
							</>
						)}
				</section>
			</div>
		</main>
	);
}
