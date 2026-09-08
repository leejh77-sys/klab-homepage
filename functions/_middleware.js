// Cloudflare Pages Functions 미들웨어 - 사이트 전체에 공유 비밀번호를 건다.
// Cloudflare Pages 프로젝트 설정 > Settings > Environment variables 에서
// SITE_PASSWORD 를 "Secret"으로 등록해야 동작한다. 값이 없으면 접근을 막는다.

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.SITE_PASSWORD) {
    return new Response("사이트 비밀번호가 설정되지 않았습니다. 관리자에게 문의하세요.", { status: 500 });
  }

  const authHeader = request.headers.get("Authorization");
  if (isAuthorized(authHeader, env.SITE_PASSWORD)) {
    return context.next();
  }

  return new Response("인증이 필요합니다.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="KLAB 내부용", charset="UTF-8"' },
  });
}

function isAuthorized(authHeader, expectedPassword) {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  try {
    const decoded = atob(authHeader.slice(6));
    const separatorIndex = decoded.indexOf(":");
    const password = separatorIndex === -1 ? decoded : decoded.slice(separatorIndex + 1);
    return password === expectedPassword;
  } catch {
    return false;
  }
}
