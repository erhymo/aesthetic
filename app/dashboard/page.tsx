"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useRouter } from "next/navigation";

type StudySet = {
	id: string;
	title: string;
	subject: string;
};

export default function Dashboard() {
	const [sets, setSets] = useState<StudySet[]>([]);
	const router = useRouter();

	useEffect(() => {
		const userId = localStorage.getItem("userId");
		if (!userId) return;

		async function load() {
			const q = query(
				collection(db, "studySets"),
				where("userId", "==", userId),
			);
			const snap = await getDocs(q);

			const data = snap.docs.map((doc) => ({
				id: doc.id,
					...(doc.data() as Omit<StudySet, "id">),
			}));

			setSets(data);
		}

		load();
	}, []);

	return (
		<main className="page-shell">
			<div className="page-container stack-lg">
				<section className="hero-panel stack-lg">
					<div className="topbar">
						<div className="stack-sm">
							<div className="brand-mark">
								<span className="brand-dot" />
								Dashboard
							</div>
							<h1 className="section-title">Dine studiesett</h1>
							<p className="lead-text">
								Hold oversikt over opplastede filer og åpne settene dine for å generere eller lese flashcards.
							</p>
						</div>

						<button onClick={() => router.push("/upload")} className="btn btn-primary">
							+ Nytt sett
						</button>
					</div>

					<div className="stats-grid">
						<div className="stat-card">
							<span className="stat-label">Antall sett</span>
							<span className="stat-value">{sets.length}</span>
						</div>
						<div className="stat-card">
							<span className="stat-label">Status</span>
							<span className="stat-value">Klar til studie</span>
						</div>
						<div className="stat-card">
							<span className="stat-label">Neste steg</span>
							<span className="stat-value">Last opp nytt sett</span>
						</div>
					</div>
				</section>

				<section className="stack-md">
					<div className="topbar">
						<h2 className="section-title text-2xl">Oversikt</h2>
						<span className="pill pill-neutral">
							{sets.length} {sets.length === 1 ? "sett" : "sett"}
						</span>
					</div>

					{sets.length === 0 ? (
						<div className="empty-panel">
							<h3 className="text-xl font-semibold">Ingen sett ennå</h3>
							<p className="muted-text mt-2">
								Start med å laste opp en PDF- eller DOCX-fil for å generere dine første flashcards.
							</p>
						</div>
					) : (
						<div className="card-grid">
							{sets.map((set) => (
								<div
									key={set.id}
									className="card-item card-item--interactive stack-sm"
									onClick={() => router.push(`/sets/${set.id}`)}
								>
									<div className="row-wrap">
										<span className="pill pill-blue">Studiesett</span>
									</div>
									<h3 className="text-xl font-semibold">{set.title}</h3>
									<p className="muted-text">{set.subject}</p>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
