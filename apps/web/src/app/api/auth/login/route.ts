import { InactiveOrMissingUserProfileError } from "@canchaya/core";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE_NAME,
  InvalidCredentialsError,
  REFRESH_TOKEN_COOKIE_NAME,
  buildAuthCookieOptions,
  signInWithPassword,
} from "@/lib/auth";

interface LoginRequestBody {
  email?: string;
  password?: string;
}

export async function POST(request: Request) {
  let body: LoginRequestBody;
  try {
    body = (await request.json()) as LoginRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Solicitud inválida. Verifica los datos enviados." },
      { status: 400 },
    );
  }

  try {
    const result = await signInWithPassword({
      email: body.email ?? "",
      password: body.password ?? "",
    });

    const response = NextResponse.json(
      {
        user: {
          userId: result.user.userId,
          tenantId: result.user.tenantId,
          role: result.user.role,
        },
        permissions: result.permissions,
      },
      { status: 200 },
    );

    const cookieOptions = buildAuthCookieOptions({
      maxAgeSeconds: result.session.expiresIn,
    });

    response.cookies.set(ACCESS_TOKEN_COOKIE_NAME, result.session.accessToken, cookieOptions);

    if (result.session.refreshToken) {
      response.cookies.set(REFRESH_TOKEN_COOKIE_NAME, result.session.refreshToken, {
        ...cookieOptions,
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return response;
  } catch (error) {
    if (error instanceof InvalidCredentialsError) {
      return NextResponse.json(
        { error: "Correo o contraseña incorrectos." },
        { status: 401 },
      );
    }

    if (error instanceof InactiveOrMissingUserProfileError) {
      return NextResponse.json(
        { error: "Tu cuenta no tiene un perfil activo asignado a un recinto." },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: "No fue posible iniciar sesión en este momento." },
      { status: 500 },
    );
  }
}

