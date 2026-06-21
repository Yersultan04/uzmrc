import { NextRequest, NextResponse } from "next/server";

// Auth guard. The bearer token lives in localStorage but is mirrored into a
// non-httpOnly `access_token` cookie by lib/auth.saveToken(), so this server
// middleware can do a best-effort redirect for unauthenticated navigation.
// Client pages additionally re-check isAuthenticated() (see StagePlaceholder)
// as a second line of defence, since the cookie can be stripped or expire.
//
// Routes:
//   /login        — public; authenticated users are bounced to "/"
//   everything else (/, /rags/*, /admin/*) — requires a token

export function middleware(req: NextRequest) {
  const token = req.cookies.get("access_token")?.value;
  const { pathname } = req.nextUrl;

  const isAuthPage = pathname.startsWith("/login");

  // Already authenticated → keep them out of /login.
  if (token && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Any non-login page requires a token.
  if (!token && !isAuthPage) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next internals, API proxy, and static assets.
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp|.*\\.gif).*)",
  ],
};
