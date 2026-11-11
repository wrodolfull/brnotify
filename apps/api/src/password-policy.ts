/** Server-owned Supabase Auth app_metadata; ordinary users cannot clear it. */
export const FORCE_PASSWORD_CHANGE = 'brnotify_force_password_change';
export function needsPasswordChange(metadata:Record<string,unknown>|null|undefined):boolean {
 return metadata?.[FORCE_PASSWORD_CHANGE]===true;
}
export function mayAccessDuringPasswordChange(path:string):boolean {
 return path==='/api/me'||path==='/api/tenant-options'||path==='/api/auth/initial-password';
}
