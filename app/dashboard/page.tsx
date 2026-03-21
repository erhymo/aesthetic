"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

type StudySet = {
	id: string;
	title: string;
	subject: string;
};

export default function Dashboard() {
	const [sets, setSets] = useState<StudySet[]>([]);

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
									Åpne et tema, velg hvor mange kort du vil øve på, og gå videre til en roligere studieflyt.
							</p>
						</div>

							<Link href="/upload" className="btn btn-primary w-full sm:w-auto">
							+ Nytt sett
							</Link>
					</div>

						<div className="row-wrap">
							<span className="pill pill-neutral">{sets.length} studiesett</span>
							<span className="pill pill-blue">Tilpasset mobil, nettbrett og desktop</span>
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
									Start med å laste opp en PDF/DOCX eller bilder av sider for å generere dine første flashcards.
							</p>
								<div className="mt-5 flex justify-center">
									<Link href="/upload" className="btn btn-primary w-full sm:w-auto">
										Last opp første sett
									</Link>
								</div>
						</div>
					) : (
						<div className="card-grid">
							{sets.map((set) => (
									<Link
									key={set.id}
										href={`/sets/${set.id}`}
										className="card-item card-item--interactive stack-sm block"
								>
									<div className="row-wrap">
										<span className="pill pill-blue">Studiesett</span>
											<span className="pill pill-neutral">Åpne kontrollsenter</span>
									</div>
									<h3 className="text-xl font-semibold">{set.title}</h3>
									<p className="muted-text">{set.subject}</p>
									</Link>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	);
}
