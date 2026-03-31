"use client";

import { useState } from "react";
import { getApiResponseErrorMessage, parseApiJson } from "@/lib/apiResponse";
import { useRouter } from "next/navigation";

export default function Home() {
	const [pin, setPin] = useState("");
	const [error, setError] = useState("");
	const [loggingIn, setLoggingIn] = useState(false);
	const router = useRouter();

	async function handleLogin() {
		if (loggingIn) {
			return;
		}

		setError("");

		try {
			setLoggingIn(true);

			const response = await fetch("/api/login", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ pin }),
			});

			const rawBody = await response.text();
			const json = parseApiJson<{ error?: string; userId?: string }>(rawBody);
			const responseError = getApiResponseErrorMessage(rawBody, "Kunne ikke logge inn.");

			if (!response.ok || typeof json?.userId !== "string") {
				setError(json?.error?.trim() || responseError);
				return;
			}

			localStorage.setItem("userId", json.userId);
			router.push("/dashboard");
			router.refresh();
		} catch (loginError) {
			console.error(loginError);
			setError("Kunne ikke logge inn. Prøv igjen om litt.");
		} finally {
			setLoggingIn(false);
		}
	}

	return (
		<main className="auth-shell">
			<div className="hero-panel w-full max-w-5xl">
				<div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr] md:items-center">
					<div className="stack-lg">
						<div className="brand-mark">
							<span className="brand-dot" />
							Aesthetic
						</div>
						<div className="stack-md">
							<h1 className="page-title">Studer smartere med rene, raske flashcards.</h1>
							<p className="lead-text">
								Last opp fagmateriale, generer flashcards og hold oversikt over settene dine i ett enkelt grensesnitt.
							</p>
						</div>
					</div>

					<div className="surface-panel stack-md">
						<div className="stack-sm">
							<h2 className="section-title text-2xl">Logg inn</h2>
							<p className="muted-text text-sm">
								Bruk PIN-koden din for å åpne dashboardet.
							</p>
						</div>

						<div className="input-group">
							<label className="input-label" htmlFor="pin">
								PIN-kode
							</label>
							<input
								id="pin"
								className="input-field text-center text-3xl tracking-[0.35em]"
								placeholder="0000"
								inputMode="numeric"
								maxLength={4}
								value={pin}
								onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ""))}
							/>
						</div>

						{error ? <p className="error-text">{error}</p> : null}

						<button
							onClick={handleLogin}
							className="btn btn-primary w-full"
								disabled={pin.length !== 4 || loggingIn}
						>
								{loggingIn ? "Logger inn..." : "Logg inn"}
						</button>
					</div>
				</div>
			</div>
		</main>
	);
}
