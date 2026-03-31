import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/authSession";

export const runtime = "nodejs";

export async function GET() {
	const userId = await getAuthenticatedUserId();

	if (!userId) {
		return NextResponse.json({ error: "Du må logge inn på nytt." }, { status: 401 });
	}

	return NextResponse.json({ authenticated: true, userId });
}