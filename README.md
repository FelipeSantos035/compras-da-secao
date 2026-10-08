# Compras da Seção

PWA estática para GitHub Pages + Supabase.

## Configuração
Edite `config.js` e cole a chave **anon/public** do projeto Supabase. Nunca coloque a `service_role` key no frontend.

## Publicação
1. Suba os arquivos na raiz do repositório.
2. GitHub → Settings → Pages.
3. Source: Deploy from a branch.
4. Branch: `main` / `/ (root)`.
5. Save.
6. Aguarde o endereço do GitHub Pages.

## Supabase Auth
Depois de publicar, cadastre o domínio do GitHub Pages em Authentication → URL Configuration:
- Site URL: endereço do GitHub Pages
- Redirect URLs: endereço do GitHub Pages

## Banco
O projeto usa as tabelas já criadas no Supabase:
participantes, competencias, pagamentos_secao, produtos_padrao, compras_secao, notas_fiscais_secao e estoque_secao.
