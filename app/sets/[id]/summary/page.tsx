"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { getApiResponseErrorMessage, parseApiJson } from "@/lib/apiResponse";
import { db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";

type SummaryState = {
	title?: string;
	intro?: string;
	bullets?: string[];
	takeaway?: string;
	status?: string;
	lastError?: string | null;
	updatedAt?: string;
	sourceLength?: number;
};

type StudySet = {
	title: string;
	subject: string;
	fileName?: string;
	summaryTitle?: string;
	summaryIntro?: string;
	summaryBullets?: string[];
	summaryTakeaway?: string;
	summaryStatus?: string;
	summaryLastError?: string | null;
	summaryUpdatedAt?: string;
	summarySourceLength?: number;
};

function formatUpdatedAt(value?: string) {
	if (!value) {
		return null;
	}

	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return new Intl.DateTimeFormat("nb-NO", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

export default function SummaryPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = use(params);
	const [data, setData] = useState<StudySet | null>(null);
	const [loading, setLoading] = useState(true);
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [autoRequested, setAutoRequested] = useState(false);

	const loadSet = useCallback(async () => {
		setLoading(true);
		setError(null);

		try {
			const snap = await getDoc(doc(db, "studySets", id));

			if (!snap.exists()) {
				setData(null);
					return null;
			}

				const studySetData = snap.data() as StudySet;
				setData(studySetData);
				return studySetData;
		} catch (loadError) {
			console.error(loadError);
			setError("Kunne ikke laste oppsummeringen.");
			setData(null);
				return null;
		} finally {
			setLoading(false);
		}
	}, [id]);

	useEffect(() => {
		void loadSet();
	}, [loadSet]);

	const summary = useMemo<SummaryState | null>(() => {
		if (!data?.summaryTitle || !data.summaryIntro || !data.summaryTakeaway) {
			return null;
		}

		return {
			title: data.summaryTitle,
			intro: data.summaryIntro,
			bullets: Array.isArray(data.summaryBullets) ? data.summaryBullets : [],
			takeaway: data.summaryTakeaway,
			status: data.summaryStatus,
			lastError: data.summaryLastError,
			updatedAt: data.summaryUpdatedAt,
			sourceLength: data.summarySourceLength,
		};
	}, [data]);

	const generateSummary = useCallback(
		async (force = false) => {
			if (generating) {
				return;
			}

			try {
				setGenerating(true);
				setError(null);

				const response = await fetch("/api/summary", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ setId: id, force }),
				});

				const rawBody = await response.text();
				const json = parseApiJson<{ error?: string }>(rawBody);
				const responseError = getApiResponseErrorMessage(
					rawBody,
					"Kunne ikke lage oppsummering.",
				);

				if (!response.ok) {
					const refreshedSet = await loadSet();
					setError(refreshedSet?.summaryLastError?.trim() || json?.error?.trim() || responseError);
					return;
				}

				await loadSet();
			} catch (generationError) {
				console.error(generationError);
				setError("Feil under generering av oppsummering.");
			} finally {
				setGenerating(false);
			}
		},
		[generating, id, loadSet],
	);

	useEffect(() => {
		if (loading || autoRequested || generating || !data) {
			return;
		}

		if (summary || data.summaryStatus === "processing") {
			return;
		}

		setAutoRequested(true);
		void generateSummary(false);
	}, [autoRequested, data, generateSummary, generating, loading, summary]);

	if (loading) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-4xl">
					<div className="empty-panel">Laster oppsummering...</div>
				</div>
			</main>
		);
	}

	if (error) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-4xl stack-lg">
					<div className="empty-panel stack-sm">
						<p>{error}</p>
						<div className="row-wrap justify-center">
							<button
								type="button"
								onClick={() => void generateSummary(true)}
								className="btn btn-primary w-full sm:w-auto"
							>
								Prøv igjen
							</button>
							<Link href={`/sets/${id}`} className="btn btn-secondary w-full sm:w-auto">
								Tilbake til studiesett
							</Link>
						</div>
					</div>
				</div>
			</main>
		);
	}

	if (!data) {
		return (
			<main className="page-shell">
				<div className="page-container max-w-4xl">
					<div className="empty-panel">Fant ikke studiesettet.</div>
				</div>
			</main>
		);
	}

	const updatedAtLabel = formatUpdatedAt(summary?.updatedAt);
	const isProcessing = generating || data.summaryStatus === "processing";

	return (
		<main className="page-shell">
			<div className="page-container max-w-4xl stack-lg">
				<section className="hero-panel stack-lg">
					<div className="topbar">
						<div className="stack-sm">
							<div className="brand-mark">
								<span className="brand-dot" />
								Kort oppsummert
							</div>
							<h1 className="section-title">{data.title}</h1>
							<p className="lead-text">
									En kort oppsummering laget kun fra teksten i materialet du lastet opp.
							</p>
						</div>

						<div className="row-wrap">
							<Link href={`/sets/${id}`} className="btn btn-secondary w-full sm:w-auto">
								Tilbake til studiesett
							</Link>
							<button
								type="button"
								onClick={() => void generateSummary(true)}
								disabled={isProcessing}
								className="btn btn-primary w-full sm:w-auto"
							>
								{isProcessing ? "Lager oppsummering..." : "Lag på nytt"}
							</button>
						</div>
					</div>

					<div className="row-wrap">
						<span className="pill pill-blue">Kun opplastet tekst</span>
						<span className="pill pill-neutral">Ingen web-kilder</span>
						<span className="pill pill-neutral">Fag: {data.subject}</span>
						{summary?.sourceLength ? (
							<span className="pill pill-neutral">Kildetekst: {summary.sourceLength} tegn</span>
						) : null}
					</div>
				</section>

				{isProcessing && !summary ? (
					<section className="surface-panel stack-md">
						<h2 className="text-2xl font-semibold">Lager oppsummering</h2>
						<p className="muted-text leading-7">
								Jeg henter teksten fra materialet, oppsummerer innholdet og lagrer resultatet på studiesettet.
						</p>
					</section>
				) : null}

				{data.summaryLastError && !summary ? (
					<section className="surface-panel stack-sm border border-rose-400/30 bg-rose-500/10">
						<h2 className="text-xl font-semibold text-rose-100">Kunne ikke lage oppsummering</h2>
						<p className="text-rose-100/90">{data.summaryLastError}</p>
					</section>
				) : null}

				{summary ? (
					<section className="surface-panel stack-lg">
						<div className="stack-sm">
							<div className="row-wrap">
								<span className="pill pill-green">Oppsummering klar</span>
								{updatedAtLabel ? (
									<span className="pill pill-neutral">Oppdatert {updatedAtLabel}</span>
								) : null}
							</div>
							<h2 className="text-3xl font-semibold leading-tight">{summary.title}</h2>
							<p className="lead-text max-w-none">{summary.intro}</p>
						</div>

						<div className="grid gap-4 md:grid-cols-[1.6fr_1fr]">
							<div className="card-item stack-sm">
								<h3 className="text-xl font-semibold">Hovedpunkter</h3>
								<ul className="list-disc space-y-3 pl-5 text-base leading-7 text-slate-100">
									{summary.bullets?.map((bullet) => (
										<li key={bullet}>{bullet}</li>
									))}
								</ul>
							</div>

							<div className="card-item stack-sm">
								<span className="pill pill-blue">Husk dette</span>
								<p className="text-lg font-semibold leading-8">{summary.takeaway}</p>
								<p className="muted-text text-sm">
									Hvis du vil, kan jeg neste steg koble denne oppsummeringen tettere mot konkrete kort og kildeutdrag.
								</p>
							</div>
						</div>
					</section>
				) : null}
			</div>
		</main>
	);
}