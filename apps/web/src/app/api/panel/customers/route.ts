import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  getAuthenticatedUserFromToken,
  requireRoleForUser,
} from "@/lib/auth";
import {
  BookingValidationError,
  createTenantCustomer,
  searchTenantCustomers,
} from "@/lib/bookings";
import { handlePanelApiError } from "@/lib/panel-api";

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "bookings:manage");

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") ?? "";

    const customers = await searchTenantCustomers({
      user,
      accessToken: accessToken!,
      query,
    });

    return NextResponse.json({ customers }, { status: 200 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudieron consultar los clientes.");
  }
}

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
    const user = await getAuthenticatedUserFromToken({ accessToken });
    requireRoleForUser(user, "customers:manage");

    const body = (await request.json().catch(() => null)) as {
      fullName?: unknown;
      phone?: unknown;
    } | null;

    if (!body || typeof body.fullName !== "string" || typeof body.phone !== "string") {
      throw new BookingValidationError("Debes enviar el nombre y el teléfono del cliente.");
    }

    const customer = await createTenantCustomer({
      user,
      accessToken: accessToken!,
      fullName: body.fullName,
      phone: body.phone,
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return handlePanelApiError(error, "No se pudo crear el cliente.");
  }
}
