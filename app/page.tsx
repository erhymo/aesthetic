"use client";

import { useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useRouter } from "next/navigation";

export default function Home() {
	const [pin, setPin] = useState("");
	const [error, setError] = useState("");
	const router = useRouter();

	async function handleLogin() {
		setError("");

		const q = query(collection(db, "users"), where("pin", "==", pin));
		const snap = await getDocs(q);

		if (snap.empty) {
			setError("Feil PIN");
			return;
		}

		const user = snap.docs[0];
		localStorage.setItem("userId", user.id);

		router.push("/dashboard");
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
							disabled={pin.length !== 4}
						>
							Logg inn
						</button>
					</div>
				</div>
			</div>
		</main>
	);
}
