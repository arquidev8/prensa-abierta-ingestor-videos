import { engineRequest, type AuthSession, type EngineUser, type UpdateUserPayload } from './authClient';

export type UpdateProfileResult =
  | { ok: true; user: EngineUser }
  | { ok: false; error: string; sessionExpired: boolean };

/**
 * Edita la cuenta del usuario logueado (PUT /api/users/:id sobre su propio id). Cambiar correo o
 * contraseña exige `current_password`; el Engine la verifica y responde 401 si no coincide.
 */
export async function updateOwnProfile(session: AuthSession, payload: UpdateUserPayload): Promise<UpdateProfileResult> {
  const result = await engineRequest<EngineUser>(`/api/users/${session.user.id}`, {
    method: 'PUT',
    token: session.token,
    json: payload,
  });
  if (result.ok) return { ok: true, user: result.data };

  // Un 401 también significa "contraseña actual incorrecta" (la sesión sigue viva): solo se
  // considera sesión vencida cuando el error habla del token.
  const sessionExpired = result.unauthorized && /sesión|Authorization/i.test(result.error);
  return { ok: false, error: result.error, sessionExpired };
}
