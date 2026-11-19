import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import { approvePendingDeposit } from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "deposits:validate");

    const { id } = await context.params;
    const result = await approvePendingDeposit({
      user,
      accessToken: accessToken!,
      paymentId: id,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo aprobar el anticipo.");
  }
}
