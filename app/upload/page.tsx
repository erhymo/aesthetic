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
			<main className="page-shell">
				<div className="page-container max-w-3xl stack-lg">
					<section className="hero-panel stack-lg">
						<div className="topbar">
							<div className="stack-sm">
								<div className="brand-mark">
									<span className="brand-dot" />
									Nytt sett
								</div>
								<h1 className="section-title">Last opp nytt materiale</h1>
								<p className="lead-text">
									Gi settet et tydelig navn, velg fag og last opp en PDF- eller DOCX-fil.
								</p>
							</div>

							<button className="btn btn-secondary" onClick={() => router.back()}>
								Tilbake
							</button>
						</div>

						<div className="surface-panel stack-md">
							<div className="input-group">
								<label className="input-label" htmlFor="title">
									Tittel
								</label>
								<input
									id="title"
									className="input-field"
									placeholder="For eksempel: Biologi kapittel 3"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
								/>
							</div>

							<div className="input-group">
								<label className="input-label" htmlFor="subject">
									Fag
								</label>
								<input
									id="subject"
									className="input-field"
									placeholder="For eksempel: Naturfag"
									value={subject}
									onChange={(e) => setSubject(e.target.value)}
								/>
							</div>

							<div className="input-group">
								<label className="input-label" htmlFor="file">
									Fil
								</label>
								<input
									id="file"
									type="file"
									accept=".pdf,.docx"
									className="file-input"
									onChange={(e) => setFile(e.target.files?.[0] ?? null)}
								/>
								<p className="muted-text text-sm">
									Støtter PDF og DOCX. {file ? `Valgt fil: ${file.name}` : "Ingen fil valgt ennå."}
								</p>
							</div>

							<div className="divider" />

							<div className="row-wrap">
								<button onClick={handleUpload} className="btn btn-primary">
									Last opp
								</button>
								<button className="btn btn-secondary" onClick={() => router.push("/dashboard")}>
									Til dashboard
								</button>
							</div>
						</div>
					</section>
				</div>
			</main>
	);
}
