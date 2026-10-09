# DINDIN-PATCHES

Documento de trabalho que descreve as customizações do dindin em relação ao upstream
(https://github.com/felipegcoutinho/openmonetis).

Após cada merge com o upstream, ler este arquivo e verificar cada ponto marcado.
Busca rápida: `grep -r "@dindin" src/`

---

## Estado atual

- **Upstream atual**: v2.7.13 (24 commits à frente do nosso merge)
- **Dindin atual**: v2.7.4 (último merge: commit `3e2f58a`)
- **Isolamento**: concluído (passos 1–5 executados) ✓
- **Próxima ação planejada**: merge com upstream v2.7.13

---

## Customizações ativas

### 1. `src/shared/lib/import/santander-pdf-parser.ts`
**Tipo**: arquivo novo (sem conflito de criação)
**O que é**: parser de fatura PDF do cartão de crédito Santander.
**Fixes nossos que não existem no upstream**:
- `buffer.slice(0)` antes de passar para o pdfjs — evita detachment do ArrayBuffer pelo Web Worker
- Tratamento de linhas IOF sem data (linhas `IOF DESPESA NO EXTERIOR X,XX`) usando `lastDate`
- Variável `SKIP_LINE_RE` não inclui `IOF\s` nem `ANUIDADE`
**Risco**: upstream também toca esse arquivo. Antes de cada merge, comparar o diff deles com o nosso e reaplicar os fixes acima se necessário.
**Marcador**: `@dindin`

### 2. `src/features/transactions/components/import/import-page.tsx`
**Tipo**: modificação em arquivo do upstream
**O que mudamos**: adicionamos `selectedTotal` e `withoutPayerCount` no `useMemo` e passamos para `ImportSummary`
**Marcador**: `@dindin selectedTotal`
**Plano de isolamento**: reduzir para 1 linha usando o slot `footer` do `ImportSummary` (ver seção abaixo)

### 3. `src/features/transactions/components/import/import-summary.tsx`
**Tipo**: modificação em arquivo do upstream
**O que mudamos**: adicionamos props `selectedTotal: number` e `withoutPayer: number`; exibimos total no canto superior direito do card
**Marcador**: `@dindin selectedTotal`
**Plano de isolamento**: substituir por prop `footer?: React.ReactNode` (ver seção abaixo)

### 4. `.github/workflows/docker-publish.yml`
**Tipo**: modificação em arquivo do upstream
**O que mudamos**: `DOCKER_IMAGE_NAME: dindin`, removemos job de deploy (self-hosted runner inviável — Vivo bloqueia api.github.com)
**Risco**: upstream DELETOU esse arquivo na v2.7.13 — conflito garantido no merge
**Plano de isolamento**: renomear para `dindin-deploy.yml` antes do merge

---

## Plano de isolamento (implementar ANTES do merge v2.7.13)

### Passo 1 — Renomear workflow (elimina conflito permanentemente)
```bash
git mv .github/workflows/docker-publish.yml .github/workflows/dindin-deploy.yml
```

### Passo 2 — Slot `footer` em `ImportSummary`
Adicionar prop opcional ao componente upstream:
```tsx
// import-summary.tsx
interface ImportSummaryProps {
    // ... props existentes do upstream (não mexer)
    footer?: React.ReactNode; // @dindin: extension point para total selecionado
}
// No JSX, renderizar {footer} no final do card
```

### Passo 3 — Reduzir patch em `import-page.tsx`
Com o slot acima, nossa modificação em `import-page.tsx` fica mínima:
```tsx
// @dindin: exibe total de despesas selecionadas para conferência da fatura
const selectedTotal = useMemo(
    () => rows
        .filter((r) => r.selected && r.transactionType === "expense")
        .reduce((sum, r) => sum + r.amount, 0),
    [rows]
);

<ImportSummary
    {...restProps}
    footer={
        <span className="font-semibold tabular-nums">
            {formatCurrency(selectedTotal)}
        </span>
    }
/>
```

### Passo 4 — Adicionar comentários `@dindin` em todos os pontos
Marcar cada bloco customizado com `// @dindin: <descrição>` para localização rápida pós-merge.

### Passo 5 — Habilitar git rerere
```bash
git config rerere.enabled true
```

### Passo 6 — Merge com upstream
```bash
git fetch upstream
git merge upstream/main
# Resolver conflitos — checar DINDIN-PATCHES.md para cada arquivo
# santander-pdf-parser.ts: tomar versão upstream + reaplicar fixes de IOF e ArrayBuffer
# demais conflitos: usar marcadores @dindin como guia
```

---

## Infraestrutura de deploy (servidor M720Q)

- **Imagem Docker**: `pcpeixoto/dindin:latest` no Docker Hub
- **Cron no servidor**: `*/5 * * * * /home/peixoto/openmonetis/deploy.sh`
- **Script**: compara image ID antes/depois do `docker compose pull` e sobe só se mudou
- **Log**: `/home/peixoto/openmonetis/deploy.log`
- **docker-compose.yml no servidor**: usa `pcpeixoto/dindin:latest` (corrigido manualmente)
- **Por que não self-hosted runner**: Vivo (ISP) bloqueia `api.github.com` (4.228.31.149, Azure Brazil South)
