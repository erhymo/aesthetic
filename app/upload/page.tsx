"use client";

import { useState } from "react";
import { db, storage } from "@/lib/firebase";
import { ref, uploadBytes } from "firebase/storage";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { useRouter } from "next/navigation";

type UploadMode = "document" | "images";

function getFileKey(file: File) {
	return `${file.name}-${file.size}-${file.lastModified}`;
}

function mergeFiles(existingFiles: File[], incomingFiles: File[]) {
	const seen = new Set<string>();

	return [...existingFiles, ...incomingFiles].filter((file) => {
		const key = getFileKey(file);

		if (seen.has(key)) {
			return false;
		}

		seen.add(key);
		return true;
	});
}

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}

	return "Noe gikk galt ved opplasting. Sjekk Firebase-reglene for Firestore og Storage.";
}

export default function Upload() {
	const [title, setTitle] = useState("");
	const [subject, setSubject] = useState("");
	const [uploadMode, setUploadMode] = useState<UploadMode>("document");
	const [files, setFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const router = useRouter();
	const trimmedTitle = title.trim();
	const trimmedSubject = subject.trim();
	const canUpload = Boolean(trimmedTitle && trimmedSubject && files.length > 0 && !uploading);
	const primaryFile = files[0] ?? null;
	const isImageMode = uploadMode === "images";

	function handleModeChange(nextMode: UploadMode) {
		if (uploading) {
			return;
		}

		setUploadMode(nextMode);
		setFiles([]);
	}

	function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
		const selectedFiles = Array.from(event.target.files ?? []);

		if (selectedFiles.length === 0) {
			return;
		}

		setFiles((currentFiles) => {
			if (uploadMode === "document") {
				return selectedFiles.slice(0, 1);
			}

			return mergeFiles(currentFiles, selectedFiles);
		});

		event.target.value = "";
	}

	function removeFile(fileToRemove: File) {
		setFiles((currentFiles) => currentFiles.filter((file) => getFileKey(file) !== getFileKey(fileToRemove)));
	}

	async function handleUpload() {
		if (uploading) {
			return;
		}

		const userId = localStorage.getItem("userId");
		if (!userId) {
			alert("Du må logge inn på nytt før du kan laste opp.");
			router.push("/");
			return;
		}

		if (!trimmedTitle || !trimmedSubject) {
			alert("Legg inn både tittel og fag før du laster opp.");
			return;
		}

		if (files.length === 0) {
			alert(isImageMode ? "Legg til minst ett bilde før du laster opp." : "Velg en fil før du laster opp.");
			return;
		}

		try {
			setUploading(true);
			const uploadPrefix = `uploads/${userId}/${Date.now()}`;
			const uploadedFiles = await Promise.all(
				files.map(async (file, index) => {
					const filePath = `${uploadPrefix}-${index}-${file.name}`;
					const storageRef = ref(storage, filePath);

					await uploadBytes(storageRef, file);

					return {
						filePath,
						fileName: file.name,
					};
				}),
			);

			if (uploadedFiles.length === 0) {
				throw new Error("Fant ingen filer å laste opp.");
			}

			const firstUploadedFile = uploadedFiles[0];

			const doc = await addDoc(collection(db, "studySets"), {
				userId,
				title: trimmedTitle,
				subject: trimmedSubject,
				filePath: firstUploadedFile.filePath,
				fileName: firstUploadedFile.fileName,
				sourceType: isImageMode ? "images" : "document",
				...(isImageMode
					? {
						filePaths: uploadedFiles.map((file) => file.filePath),
						fileNames: uploadedFiles.map((file) => file.fileName),
					}
					: null),
				status: "uploaded",
				createdAt: serverTimestamp(),
			});

			router.push(`/sets/${doc.id}`);
		} catch (error) {
			console.error(error);
			alert(getErrorMessage(error));
		} finally {
			setUploading(false);
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
									{isImageMode
										? "Gi settet et tydelig navn, velg fag og legg til bilder av sidene du vil pugge."
										: "Gi settet et tydelig navn, velg fag og last opp en PDF- eller DOCX-fil."}
								</p>
							</div>

						<button className="btn btn-secondary" onClick={() => router.back()} disabled={uploading}>
								Tilbake
							</button>
						</div>

						<div className="surface-panel stack-md">
								<div className="stack-sm">
									<label className="input-label">Hvordan vil du legge inn materiale?</label>
									<div className="row-wrap">
										<button
											type="button"
											onClick={() => handleModeChange("document")}
											disabled={uploading}
											className={uploadMode === "document" ? "btn btn-primary" : "btn btn-secondary"}
										>
											Last opp fil
										</button>
										<button
											type="button"
											onClick={() => handleModeChange("images")}
											disabled={uploading}
											className={uploadMode === "images" ? "btn btn-primary" : "btn btn-secondary"}
										>
											Ta bilde / velg bilder
										</button>
									</div>
									<p className="muted-text text-sm">
										Velg én fil hvis du har PDF eller DOCX. Velg bilder hvis du vil ta bilde av sider og la appen lese teksten med OCR.
									</p>
								</div>

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
								disabled={uploading}
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
								disabled={uploading}
								/>
							</div>

							<div className="input-group">
									<label className="input-label" htmlFor="source-file">
										{isImageMode ? "Bilder av sider" : "Fil"}
								</label>
								<input
										key={uploadMode}
										id="source-file"
									type="file"
										accept={isImageMode ? ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" : ".pdf,.docx"}
										multiple={isImageMode}
									className="file-input"
										onChange={handleFileChange}
								disabled={uploading}
								/>
								<p className="muted-text text-sm">
										{isImageMode
											? "Støtter JPG, PNG og WEBP. Du kan velge flere bilder samtidig eller legge til flere i flere omganger."
											: "Støtter PDF og DOCX."}
								</p>

									{files.length > 0 ? (
										<div className="stack-sm rounded-2xl border border-white/10 bg-white/5 p-4">
											<div className="row-wrap items-center justify-between">
												<span className="pill pill-blue">
													{isImageMode ? `${files.length} bilder klare` : "1 fil klar"}
												</span>
												<button
													type="button"
													onClick={() => setFiles([])}
													disabled={uploading}
													className="text-sm font-medium text-slate-300 underline underline-offset-4 transition hover:text-white disabled:opacity-60"
												>
													Fjern alle
												</button>
											</div>
											<ul className="space-y-2 text-sm text-slate-200">
												{files.map((file) => (
													<li key={getFileKey(file)} className="flex items-center justify-between gap-3">
														<span className="truncate">{file.name}</span>
														<button
															type="button"
															onClick={() => removeFile(file)}
															disabled={uploading}
															className="text-sm font-medium text-slate-300 underline underline-offset-4 transition hover:text-white disabled:opacity-60"
														>
															Fjern
														</button>
													</li>
												))}
											</ul>
										</div>
									) : (
										<p className="muted-text text-sm">
											{isImageMode
												? "Ingen bilder lagt til ennå. På mobil kan du ta bilde direkte eller velge fra kamerarullen."
												: primaryFile
													? `Valgt fil: ${primaryFile.name}`
													: "Ingen fil valgt ennå."}
										</p>
									)}
							</div>

							<div className="divider" />

							<div className="row-wrap">
								<button onClick={handleUpload} className="btn btn-primary" disabled={!canUpload}>
										{uploading ? "Laster opp..." : isImageMode ? "Last opp bilder" : "Last opp fil"}
								</button>
								<button className="btn btn-secondary" onClick={() => router.push("/dashboard")} disabled={uploading}>
									Til dashboard
								</button>
							</div>
						</div>
					</section>
				</div>
			</main>
	);
}
