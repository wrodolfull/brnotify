# Usuários por ambiente sem SMTP

O Super Admin abre **Acessos**, seleciona um ambiente, clica **Novo usuário** e informa nome, e-mail e função (Administrador/Visualizador).

- Para **e-mails novos**, o backend usa `supabase.auth.admin.createUser` com e-mail confirmado e senha aleatória criptograficamente forte. Não dispara convite. O painel mostra as credenciais apenas na resposta inicial, para repasse por canal seguro. Não são persistidas pelo frontend.
- Para **usuários já existentes no Supabase Auth**, somente o vínculo ao ambiente é criado/atualizado. A senha existente permanece inalterada.
- O Super Admin pode usar **Redefinir senha** para gerar uma nova senha provisória quando alguém perder o acesso; o usuário precisa trocá-la no próximo login.
- A senha provisória é transmitida por HTTPS, uma única vez; não copie para planilhas, tickets, grupos públicos ou logs.

## Primeiro acesso

O Supabase Auth armazena `app_metadata.brnotify_force_password_change=true` em contas criadas ou redefinidas. Esse marcador é administrado somente pelo backend. Depois da autenticação, o frontend mostra uma tela obrigatória de nova senha, com confirmação, mínimo 12 caracteres, letras e números.

A API confere o estado atual do usuário com `auth.getUser` e **bloqueia os demais endpoints autenticados** com HTTP 403 até a troca, permitindo somente `/api/me`, `/api/tenant-options` e `POST /api/auth/initial-password`. A atualização da senha e a remoção do marcador ocorrem juntas no Supabase Admin API; então o frontend encerra a sessão e solicita novo login com a senha definitiva.

A senha de um usuário preexistente não é alterada ao conceder acesso a outro ambiente. Contas antigas sem o marcador não são obrigadas a trocar senha na implantação.

## Atualização da VPS

Nenhuma migração SQL é necessária para este recurso. Publique backend e painel juntos (`npm install`, `npm run build`, `pm2 restart brnotify-api brnotify-worker --update-env`).

Recomendado: configurar SMTP de produção futuramente para autorrecuperação de senha; até lá, o Super Admin pode redefinir a senha temporária pela área Acessos.

## Checagens

1. Criar um novo usuário como Super Admin; conferir senha gerada e permissão do tenant.
2. Fazer login com senha provisória e verificar bloqueio de navegação e da API (403 nos dados).
3. Trocar por senha com 12+ caracteres, letras e números, confirmar, autenticar novamente.
4. Reutilizar a mesma conta em outro tenant; não pode redefinir sua senha original.
5. Redefinir senha de um usuário existente; exigir novamente troca no login.
6. Usuários sem alteração pendente e integrações externas já existentes continuam operacionais.
