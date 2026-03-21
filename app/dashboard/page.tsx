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
		<main className="p-6 max-w-2xl mx-auto">
			<h1 className="text-2xl font-semibold mb-6">Dine sett</h1>

			<button
				onClick={() => router.push("/upload")}
				className="mb-6 border p-3 rounded-xl"
			>
				+ Nytt sett
			</button>

			<div className="space-y-3">
				{sets.map((set) => (
					<div
						key={set.id}
						className="border p-4 rounded-xl cursor-pointer"
						onClick={() => router.push(`/sets/${set.id}`)}
					>
						<h2 className="font-medium">{set.title}</h2>
						<p className="text-sm text-gray-500">{set.subject}</p>
					</div>
				))}
			</div>
		</main>
	);
}
