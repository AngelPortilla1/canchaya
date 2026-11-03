import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE_NAME, REFRESH_TOKEN_COOKIE_NAME, signOutWithToken } from "@/lib/auth";

export async function POST() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;

  try {
    await signOutWithToken({ accessToken });
  } catch {
    // Always clear local session cookies even if upstream revocation fails
  }

  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.delete(ACCESS_TOKEN_COOKIE_NAME);
  response.cookies.delete(REFRESH_TOKEN_COOKIE_NAME);
  return response;
}
