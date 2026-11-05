/** Keep the UI mounted across SIGNED_IN re-emissions and token refreshes.
 * Authentication state is only replaced when the actual account changes.
 * The newest token is stored separately and used at request time.
 */
export function preserveAuthenticatedView<T extends {user:{id:string}}>(
 current:T|null,next:T|null
):T|null{
 return current?.user.id===next?.user.id?current:next;
}
export function requireActiveSession<T>(ref:{current:T|null}):T{
 if(!ref.current)throw new Error('Sessão encerrada. Entre novamente.');
 return ref.current;
}
