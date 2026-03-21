export type StoredStudySetFile = {
	filePath: string;
	fileName: string;
};

function toTrimmedStringArray(value: unknown) {
	if (!Array.isArray(value)) {
		return [] as string[];
	}

	return value
		.filter((entry): entry is string => typeof entry === "string")
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function getStoredStudySetFiles(data: Record<string, unknown>): StoredStudySetFile[] {
	const filePaths = toTrimmedStringArray(data.filePaths);
	const fileNames = toTrimmedStringArray(data.fileNames);

	const pairedFiles = filePaths.flatMap((filePath, index) => {
		const fileName = fileNames[index];

		if (!filePath || !fileName) {
			return [];
		}

		return [{ filePath, fileName }];
	});

	if (pairedFiles.length > 0) {
		return pairedFiles;
	}

	const filePath = typeof data.filePath === "string" ? data.filePath.trim() : "";
	const fileName = typeof data.fileName === "string" ? data.fileName.trim() : "";

	if (!filePath || !fileName) {
		return [];
	}

	return [{ filePath, fileName }];
}