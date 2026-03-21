import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	turbopack: {
		root: projectRoot,
		resolveAlias: {
			tailwindcss: path.join(projectRoot, "node_modules/tailwindcss"),
		},
	},
};

export default nextConfig;
