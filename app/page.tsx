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
		<main className="flex min-h-screen items-center justify-center">
			<div className="p-6 border rounded-2xl w-80 space-y-4">
				<h1 className="text-xl font-semibold text-center">Aesthetic</h1>

				<input
					className="w-full border p-3 rounded-xl text-center text-2xl"
					placeholder="PIN"
					maxLength={4}
					value={pin}
					onChange={(e) => setPin(e.target.value)}
				/>

				{error && <p className="text-red-500 text-sm">{error}</p>}

				<button
					onClick={handleLogin}
					className="w-full border rounded-xl p-3"
				>
					Logg inn
				</button>
			</div>
		</main>
	);
}
