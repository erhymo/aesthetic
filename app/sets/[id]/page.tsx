"use client";

import { use, useCallback, useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import {
	collection,
	doc,
	getDoc,
	getDocs,
	orderBy,
	query,
} from "firebase/firestore";

type Card = {
	id: string;
	question: string;
	answer: string;
	difficulty: "easy" | "medium" | "hard";
};

type StudySet = {
	title: string;
	subject: string;
	status: string;
	cardCount?: number;
};

function getStatusClass(status: string) {
	if (status === "completed") return "pill pill-green";
	if (status === "processing") return "pill pill-amber";
	return "pill pill-blue";
}

function getDifficultyClass(difficulty: Card["difficulty"]) {
	if (difficulty === "easy") return "pill pill-green";
	if (difficulty === "hard") return "pill pill-rose";
	return "pill pill-amber";
}

export default function StudySetPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const [data, setData] = useState<StudySet | null>(null);
	const [cards, setCards] = useState<Card[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [processing, setProcessing] = useState(false);

	const loadSet = useCallback(async () => {
		setLoading(true);
		setError(null);

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

			const loadedCards = cardsSnap.docs.map((d) => ({
				id: d.id,
				...(d.data() as Omit<Card, "id">),
			}));

			setCards(loadedCards);
		} catch (error) {
			console.error(error);
			setError("Kunne ikke laste studiesettet.");
			setData(null);
			setCards([]);
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		void loadSet();
	}, [loadSet]);

	async function handleGenerate() {
		try {
			setProcessing(true);

			const res = await fetch("/api/process", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ setId: id }),
			});

			const json = await res.json();

			if (!res.ok) {
				alert(json.error || "Noe gikk galt");
				return;
			}

			await loadSet();
			alert(`Ferdig. Genererte ${json.cardCount} flashcards.`);
		} catch (err) {
			console.error(err);
			alert("Feil under generering");
		} finally {
			setProcessing(false);
		}
	}

	if (loading) return <main className="page-shell"><div className="page-container"><div className="empty-panel">Laster...</div></div></main>;
	if (error) return <main className="page-shell"><div className="page-container"><div className="empty-panel">{error}</div></div></main>;
	if (!data) return <main className="page-shell"><div className="page-container"><div className="empty-panel">Fant ikke studiesettet.</div></div></main>;

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
								Se status, generer flashcards og gå gjennom kortene i et ryddig arbeidsområde.
							</p>
						</div>

						<div className="row-wrap">
							<button className="btn btn-secondary" onClick={() => history.back()}>
								Tilbake
							</button>
							<button
								onClick={handleGenerate}
								disabled={processing}
								className="btn btn-primary"
							>
								{processing ? "Genererer..." : "Generer flashcards"}
							</button>
						</div>
					</div>

					<div className="row-wrap">
						<span className="pill pill-neutral">Fag: {data.subject}</span>
						<span className={getStatusClass(data.status)}>Status: {data.status}</span>
					</div>

					<div className="stats-grid">
						<div className="stat-card">
							<span className="stat-label">Cards</span>
							<span className="stat-value">{cards.length}</span>
						</div>
						<div className="stat-card">
							<span className="stat-label">Generering</span>
							<span className="stat-value">{processing ? "Pågår" : "Klar"}</span>
						</div>
						<div className="stat-card">
							<span className="stat-label">Studieoppsett</span>
							<span className="stat-value">Enkelt og ryddig</span>
						</div>
					</div>
				</section>

				<section className="stack-md">
					<div className="topbar">
						<h2 className="section-title text-2xl">Flashcards</h2>
						<span className="pill pill-neutral">{cards.length} kort</span>
					</div>

					{cards.length === 0 ? (
						<div className="empty-panel">
							<h3 className="text-xl font-semibold">Ingen flashcards ennå</h3>
							<p className="muted-text mt-2">
								Trykk på «Generer flashcards» for å fylle settet med spørsmål og svar.
							</p>
						</div>
					) : (
						<div className="card-grid">
							{cards.map((card) => (
								<div key={card.id} className="card-item stack-sm">
									<div className="row-wrap">
										<span className={getDifficultyClass(card.difficulty)}>
											{card.difficulty}
										</span>
									</div>
									<h3 className="text-lg font-semibold">{card.question}</h3>
									<p className="muted-text leading-7">{card.answer}</p>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
