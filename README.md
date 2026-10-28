# Stratify

Controle financeiro pessoal em forma de PWA (web app instalável), otimizado para iPhone.

- Contas fixas (recorrentes) e gastos pontuais, com categorias
- Salário / receitas fixas e entradas pontuais
- Gráficos: despesas por categoria, receitas × despesas (6 meses), ritmo de gastos vs mês anterior, comparação por categoria
- Rendimentos: previsão do cofrinho PicPay (% do CDI, dias úteis e feriados nacionais), fechamento do mês e projeção de 6 a 36 meses
- Funciona offline; dados ficam no aparelho e, opcionalmente, sincronizam com um repositório **privado** no GitHub

Sem build, sem dependências: HTML + CSS + JS puros (Chart.js via CDN).

## Publicar de graça (GitHub Pages)

1. Crie um repositório **público** no GitHub (ex.: `stratify`) e envie todos os arquivos desta pasta
   (pelo GitHub Desktop ou arrastando os arquivos em *Add file → Upload files*).
2. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Em ~1 minuto o app estará em `https://SEU-USUARIO.github.io/stratify/`.

O código é público, mas **nenhum dado financeiro fica nele**: os dados ficam no aparelho e no repositório privado de sincronização.

## Instalar no iPhone

Abra o endereço no **Safari** → botão **Compartilhar** → **Adicionar à Tela de Início**.
O app abre em tela cheia, como um app nativo.

> O app instalado tem armazenamento separado do Safari. Cadastre os dados já pelo ícone da Tela de Início
> (ou configure a sincronização, que resolve isso).

## Sincronização com GitHub (recomendado)

Garante que seus dados não se percam (troca de celular, limpeza do Safari) e mantém histórico de versões de graça.

1. Crie um repositório **privado** vazio, ex.: `stratify-data`.
2. Crie um token em **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**:
   - *Repository access*: **Only select repositories** → `stratify-data`
   - *Permissions → Repository permissions → Contents*: **Read and write**
   - Validade: a maior que preferir (anote para renovar)
3. No app: **Ajustes (engrenagem) → Sincronização** → preencha usuário, repositório e token → **Salvar e sincronizar**.

O app cria/atualiza `stratify-data.json` nesse repositório a cada alteração e busca a versão mais nova ao abrir.
O token fica salvo só no aparelho e só tem acesso a esse repositório.

## Backup manual

**Ajustes → Backup → Exportar** gera um `.json` (no iPhone abre a folha de compartilhamento: salve em Arquivos/iCloud).
**Importar** restaura um backup.

## Atualizar o app

Depois de alterar arquivos, troque `VERSION` em `sw.js` (ex.: `stratify-v2`) e publique.
No iPhone, feche e abra o app duas vezes para pegar a versão nova.

## Estrutura

```
index.html            shell + barra de abas
css/styles.css        visual (tokens de cor no :root)
js/app.js             telas, formulários e ações
js/store.js           dados, persistência local e totais do mês
js/finance.js         dias úteis, CDI diário e projeções
js/sync.js            sincronização com a API de conteúdos do GitHub
js/charts.js          gráficos (Chart.js)
sw.js                 cache offline
```

### Como o rendimento é calculado

Taxa diária = `((1 + CDI)^(1/252) − 1) × %CDI`, aplicada em cada dia útil (fins de semana e feriados nacionais,
incluindo Carnaval, Sexta-feira Santa e Corpus Christi, não rendem). Aportes rendem a partir do dia útil seguinte.
O valor líquido é estimado com a alíquota de IR escolhida (tabela regressiva); o IR só é cobrado no resgate.
