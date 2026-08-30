// Helper de fetch para el Go Engine desde componentes de CLIENTE ('use client').
// A diferencia de lib/engine.ts (server-only, usa ENGINE_INTERNAL_URL), este módulo
// corre en el navegador y por lo tanto solo puede usar NEXT_PUBLIC_ENGINE_URL.
//
// Su propósito es distinguir explícitamente dos casos que antes se colapsaban en el
// mismo `catch (err) { ...; return [] }`:
//   1. El Engine respondió pero con un error HTTP (ej. 404, 500).
//   2. El Engine es inalcanzable (fetch lanzó una excepción: ECONNREFUSED, timeout, etc.).
// El caso (2) es el que la UI debe mostrar como "Motor Go no disponible" en vez de una
// lista vacía indistinguible de "no hay datos".

export const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || 'http://localhost:8085';

export type EngineFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; offline: boolean; error: string };

/**
 * Hace un fetch al Go Engine y clasifica el resultado como éxito, error HTTP
 * (Engine alcanzable pero respondió con status no-2xx) o "offline" (el fetch
 * lanzó una excepción, típicamente porque el Engine no está corriendo).
 */
export async function fetchFromEngine<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<EngineFetchResult<T>> {
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, init);
    if (!res.ok) {
      return {
        ok: false,
        offline: false,
        error: `El Motor Go respondió con error ${res.status} en ${path}`,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    console.error(`Error de conexión con el Motor Go (${path}):`, err);
    return {
      ok: false,
      offline: true,
      error: 'No se pudo conectar con el Motor Go (Engine). Verifica que el servicio esté corriendo.',
    };
  }
}
