"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getApiResponseErrorMessage, parseApiJson } from "@/lib/apiResponse";
import { db } from "@/lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

type StudySet = {
	id: string;
	title: string;
	subject: string;
};

export default function Dashboard() {
	const [sets, setSets] = useState<StudySet[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const router = useRouter();

	useEffect(() => {
		let cancelled = false;

		async function load() {
			setLoading(true);
			setError(null);

			try {
				const sessionResponse = await fetch("/api/session", { cache: "no-store" });
				const rawBody = await sessionResponse.text();
				const sessionJson = parseApiJson<{ error?: string; userId?: string }>(rawBody);
				const responseError = getApiResponseErrorMessage(
					rawBody,
					"Kunne ikke laste innloggingen.",
				);

				if (!sessionResponse.ok || typeof sessionJson?.userId !== "string") {
					if (sessionResponse.status === 401) {
						router.replace("/");
						return;
					}

					if (!cancelled) {
						setSets([]);
						setError(sessionJson?.error?.trim() || responseError);
					}

					return;
				}

				const setsQuery = query(
					collection(db, "studySets"),
					where("userId", "==", sessionJson.userId),
				);
				const snap = await getDocs(setsQuery);

				if (cancelled) {
					return;
				}

				setSets(
					snap.docs.map((doc) => ({
						id: doc.id,
						...(doc.data() as Omit<StudySet, "id">),
					})),
				);
			} catch (loadError) {
				console.error(loadError);

				if (!cancelled) {
					setSets([]);
					setError("Kunne ikke laste dashboardet.");
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		}

		void load();

		return () => {
			cancelled = true;
		};
	}, [router]);

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

					{loading ? (
						<div className="empty-panel">Laster studiesettene dine...</div>
					) : error ? (
						<div className="empty-panel">
							<h3 className="text-xl font-semibold">Kunne ikke laste dashboardet</h3>
							<p className="muted-text mt-2">{error}</p>
						</div>
					) : sets.length === 0 ? (
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
