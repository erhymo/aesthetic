import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	outputFileTracingIncludes: {
		"/api/process": [
			"./node_modules/pdf-parse/**/*",
			"./node_modules/pdfjs-dist/**/*",
		],
		"/api/parse-file": [
			"./node_modules/pdf-parse/**/*",
			"./node_modules/pdfjs-dist/**/*",
		],
		"/api/summary": [
			"./node_modules/pdf-parse/**/*",
			"./node_modules/pdfjs-dist/**/*",
		],
	},
	turbopack: {
		root: projectRoot,
		resolveAlias: {
			tailwindcss: path.join(projectRoot, "node_modules/tailwindcss"),
		},
	},
};

export default nextConfig;
