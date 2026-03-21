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

	if (loading) return <main className="p-6">Laster...</main>;
	if (error) return <main className="p-6">{error}</main>;
	if (!data) return <main className="p-6">Fant ikke studiesettet.</main>;

	return (
		<main className="p-6 max-w-3xl mx-auto">
			<div className="border rounded-2xl p-6 mb-6 space-y-2">
				<h1 className="text-2xl font-semibold">{data.title}</h1>
				<p>Fag: {data.subject}</p>
				<p>Status: {data.status}</p>
				<p>Antall cards: {cards.length}</p>

				<button
					onClick={handleGenerate}
					disabled={processing}
					className="mt-4 border rounded-xl px-4 py-3 disabled:opacity-50"
				>
					{processing ? "Genererer..." : "Generer flashcards"}
				</button>
			</div>

			<div className="space-y-4">
				{cards.length === 0 ? (
					<p>Ingen flashcards ennå.</p>
				) : (
					cards.map((card) => (
						<div key={card.id} className="border rounded-2xl p-5 space-y-2">
							<p className="text-xs uppercase tracking-wide text-gray-500">
								{card.difficulty}
							</p>
							<h2 className="font-semibold">{card.question}</h2>
							<p>{card.answer}</p>
						</div>
					))
				)}
			</div>
		</main>
	);
}
