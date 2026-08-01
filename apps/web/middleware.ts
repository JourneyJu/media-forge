import { NextResponse, type NextRequest } from "next/server";

const publicPathPrefixes = [
  "/login",
  "/_next",
  "/favicon.ico",
  "/login-background.png"
];

function isPublicPath(pathname: string): boolean {
  return publicPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const hasRefreshCookie = Boolean(request.cookies.get("mediaforge_refresh")?.value);

  if (!hasRefreshCookie && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|.*\\..*).*)"]
};
