# Diagnóstico e contenção de acesso entre tenants

Um Administrador de tenant (`tenant_members.role='admin'`) **não** é um Super Admin. O acesso global depende exclusivamente de registro em `public.platform_admins`, conferido no servidor com o ID autenticado pelo Supabase. O frontend usa `actor.superAdmin` para exibir **Ambientes** e **Acessos**; o seletor de ambiente obtém a lista do backend `/api/tenant-options` filtrada por vínculos.

## Verificação de incidente em produção

1. Peça ao usuário testar em uma janela anônima, usando **e-mail e senha da nova conta**. Criar outro usuário pela interface **não troca a sessão atual do Super Admin**.
2. No painel, após login, verifique se o perfil é indicado como **Super Admin** ou **Admin**.
3. No Supabase SQL Editor, consulte **sem fazer alteração**:

```sql
SELECT u.email, u.id AS user_id,
 EXISTS (SELECT 1 FROM public.platform_admins p WHERE p.user_id=u.id) AS super_admin,
 t.id AS tenant_id, t.name AS tenant, m.role AS role
FROM auth.users u
LEFT JOIN public.tenant_members m ON m.user_id=u.id
LEFT JOIN public.tenants t ON t.id=m.tenant_id
WHERE lower(u.email)=lower('EMAIL_DA_CONTA_DE_TESTE');
```

4. Se `super_admin=true` para uma conta que não deveria ter acesso global, remova **somente** seu registro em `platform_admins`, após confirmação administrativa e backup. Não remova indiscriminadamente Super Admin legítimos.
5. Se existem vínculos indevidos em `tenant_members`, preserve evidências e remova somente as linhas não autorizadas, após identificar o usuário e tenant corretos.
6. Termine a sessão e faça login novamente. Confirme os campos retornados por `GET /api/me` e a lista de `GET /api/tenant-options`, sem compartilhar JWTs.
7. Confirme que uma requisição com `x-tenant-id` de outra empresa devolve **403** em um endpoint protegido, inclusive para GET, POST ou PATCH.

## Defesa em profundidade aplicada

- O backend usa uma função testável única que distingue permissões por tenant de acesso global; privilégios não são inferidos de `role='admin'`.
- O Super Admin pode conceder acesso a **mais de um tenant por conta comum**, com permissão `admin` ou `viewer` independente por tenant. Quando já há vínculo com outra empresa, a criação do vínculo exige confirmação explícita `allow_existing_membership=true`; caso contrário retorna HTTP 409. Contas de Super Admin não podem ser reutilizadas como contas de membros.
- O banco usa chave primária composta `(tenant_id,user_id)` e **não deve receber índice `UNIQUE(user_id)`**: múltiplos vínculos são permitidos por decisão de produto.
- O seletor mostra somente os tenants autorizados pela API `GET /api/tenant-options`. Para um único tenant, mostra apenas o nome. Para dois ou mais, habilita a troca; os componentes da tela são remontados na troca.
- A criação de acesso a uma empresa não altera a senha nem as permissões concedidas em outra empresa. Remover um vínculo também não elimina a conta de autenticação nem outros vínculos.
- São executados testes para cabeçalho de tenant forjado, leitor tentando escrita, confirmação exigida para múltiplos vínculos, permissões independentes por empresa e reutilização de identidade Super Admin.

Não publique credenciais, senhas, IDs de sessão ou tokens em tickets e capturas de tela. As limitações de RLS e de chaves de integração devem continuar sendo auditadas separadamente.
