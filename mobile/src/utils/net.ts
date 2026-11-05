/** fetch с таймаутом: на мобильной сети запрос может повиснуть навсегда. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 12000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error(`нет ответа за ${Math.round(ms / 1000)} с (${new URL(url).host})`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}
