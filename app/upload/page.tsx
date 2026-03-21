"use client";

import { useState } from "react";
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes } from "firebase/storage";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return "Noe gikk galt ved opplasting. Sjekk Firebase-reglene for Firestore og Storage.";
}

export default function Upload() {
	const [title, setTitle] = useState("");
	const [subject, setSubject] = useState("");
	const [file, setFile] = useState<File | null>(null);
	const router = useRouter();

	async function handleUpload() {
		const userId = localStorage.getItem("userId");
		if (!userId) {
			alert("Du må logge inn på nytt før du kan laste opp.");
			router.push("/");
			return;
		}

		if (!file) {
			alert("Velg en fil før du laster opp.");
			return;
		}

		try {
			const filePath = `uploads/${userId}/${Date.now()}-${file.name}`;
			const storageRef = ref(storage, filePath);

			await uploadBytes(storageRef, file);

			const doc = await addDoc(collection(db, "studySets"), {
				userId,
				title,
				subject,
				filePath,
				fileName: file.name,
				status: "uploaded",
				createdAt: serverTimestamp(),
			});

			router.push(`/sets/${doc.id}`);
			} catch (error) {
			console.error(error);
				alert(getErrorMessage(error));
		}
	}

	return (
		<main className="p-6 max-w-xl mx-auto space-y-4">
			<h1 className="text-2xl font-semibold">Nytt sett</h1>
			<button
				className="text-sm text-gray-500 underline"
				onClick={() => router.back()}
			>
				Tilbake
			</button>

			<input
				className="w-full border p-3 rounded-xl"
				placeholder="Tittel"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
			/>

			<input
				className="w-full border p-3 rounded-xl"
				placeholder="Fag"
				value={subject}
				onChange={(e) => setSubject(e.target.value)}
			/>

			<input
				type="file"
				accept=".pdf,.docx"
				onChange={(e) => setFile(e.target.files?.[0] ?? null)}
			/>

			<button onClick={handleUpload} className="border p-3 rounded-xl">
				Last opp
			</button>
		</main>
	);
}
