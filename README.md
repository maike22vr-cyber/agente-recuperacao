# Agente de Recuperação de Vendas (Hubla + WhatsApp + Grok)

## Como usar (passo a passo simples)

### 1. Coloque suas chaves
- Copie o arquivo `.env.example` e renomeie para `.env`
- Abra o `.env` e cole:
  - Seu token permanente do WhatsApp
  - Sua chave da API do Grok
  - O Phone Number ID já está preenchido

### 2. Suba no Railway (recomendado)
1. Acesse https://railway.app e crie uma conta
2. Clique em **New Project** → **Deploy from GitHub** (ou faça upload dos arquivos)
3. Adicione as variáveis de ambiente (as mesmas do `.env`)
4. O Railway vai te dar uma URL pública (ex: `https://seu-projeto.up.railway.app`)

### 3. Configure o webhook do WhatsApp
- No Meta, vá em WhatsApp → API Setup → Webhook
- Callback URL: `https://sua-url-do-railway.app/webhook`
- Verify Token: o mesmo que está no `.env` (`meu_token_secreto_123`)
- Assine os eventos: `messages`

### 4. Configure o webhook da Hubla
- Na Hubla, crie uma regra de webhook
- URL: `https://sua-url-do-railway.app/hubla`
- Eventos: carrinho abandonado, pagamento falhou, reembolso etc.

### 5. Teste
- Mande uma mensagem para o número do WhatsApp
- Ou dispare um evento de teste da Hubla

Pronto. O agente vai responder usando o Grok.
