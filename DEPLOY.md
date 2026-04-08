# Deploy — Fluxo Desktop → OrangePi

## Visão Geral

```
upstream (felipegcoutinho/openmonetis)
        ↓ git fetch + merge
desktop (peixoto-pc/dindin)
        ↓ git push origin main
GitHub Actions
        ↓ build linux/arm64 + push
Docker Hub (pcpeixoto/dindin:latest)
        ↓ update.sh
OrangePi 3B (192.168.15.171:3001)
```

---

## 1. Puxar atualizações do repositório original

Execute no desktop, dentro de `/home/ppeixoto/projects/dindin`:

```bash
# Adiciona o upstream (só precisa fazer uma vez)
git remote add upstream https://github.com/felipegcoutinho/openmonetis.git

# Busca e merge as atualizações
git fetch upstream
git merge upstream/main

# Resolve conflitos se houver, depois faz push
git push origin main
```

---

## 2. Acompanhar o build

Após o push, o GitHub Actions inicia automaticamente.

Acesse: [github.com/peixoto-pc/dindin/actions](https://github.com/peixoto-pc/dindin/actions)

O workflow **Build and Push to Docker Hub** irá:
- Rodar lint
- Buildar a imagem para `linux/amd64` e `linux/arm64`
- Publicar `pcpeixoto/dindin:latest` no Docker Hub

---

## 3. Atualizar o OrangePi

Após o workflow ficar verde:

```bash
ssh orangepi@192.168.15.171
~/dindin/update.sh
```

O script `update.sh` executa:
```bash
docker compose pull       # baixa a nova imagem do Docker Hub
docker compose up -d      # recria os containers
docker image prune -f     # remove imagens antigas
```

---

## 4. Verificar a aplicação

Acesse no navegador:

```
http://192.168.15.171:3001
```

---

## Referências

| Item | Valor |
|---|---|
| Fork GitHub | github.com/peixoto-pc/dindin |
| Imagem Docker Hub | pcpeixoto/dindin:latest |
| OrangePi | 192.168.15.171:3001 |
| Usuário OrangePi | orangepi |
| Pasta no OrangePi | ~/dindin |
