require('dotenv').config({ path: './tokens.env' });
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const {
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  GROK_API_KEY,
  VERIFY_TOKEN,
  PORT = 3000
} = process.env;

// Armazena conversas simples em memória
const conversations = new Map();

// Mensagens iniciais aprovadas
const MENSAGENS = {
  abandonado: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nVi que sua compra ficou pela metade e tem um detalhe do pagamento que precisa de atenção.\n\nPrefere que eu te mande o link de novo ou prefere me contar o que aconteceu?`,

  cartao: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nVi que deu um problema no cartão na hora de finalizar.\n\nPrefere que eu gere um novo link ou prefere me dizer o que apareceu na tela?`,

  reembolso: (nome) =>
    `Oi ${nome}, aqui é a Thais da equipe da Suellen.\n\nSeu pedido de reembolso chegou aqui. Só preciso de uma confirmação rápida pra liberar.\n\nPode me confirmar por aqui?`
};

// Webhook verification (Meta)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('Webhook verificado');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// Recebe mensagens do WhatsApp
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from;
      const text = message.text.body;

      console.log(`Mensagem de ${from}: ${text}`);

      const reply = await askGrok(from, text);
      await sendWhatsApp(from, reply);
    }
  }

  res.sendStatus(200);
});

// Webhook da Hubla
app.post('/hubla', async (req, res) => {
  const event = req.body;
  console.log('Evento Hubla:', event.type || event.event?.type);

  const type = event.type || event.event?.type;
  const phone = event.event?.lead?.phone || event.lead?.phone || event.event?.user?.phone;
  const name = event.event?.lead?.fullName || event.lead?.fullName || event.event?.user?.firstName || 'Cliente';

  if (!phone) {
    return res.sendStatus(200);
  }

  let mensagem = null;

  if (type === 'lead.abandoned_checkout') {
    mensagem = MENSAGENS.abandonado(name);
  } else if (type === 'invoice.payment_failed' || type === 'payment.failed') {
    mensagem = MENSAGENS.cartao(name);
  } else if (type === 'refund_request.created' || type === 'refund.created') {
    mensagem = MENSAGENS.reembolso(name);
  }

  if (mensagem) {
    setTimeout(async () => {
      await sendWhatsApp(phone.replace(/\D/g, ''), mensagem);
    }, 5 * 60 * 1000);
  }

  res.sendStatus(200);
});

// Endpoint de teste manual
app.get('/teste', (req, res) => {
  const tipo = (req.query.tipo || 'abandonado').toLowerCase();
  const nome = req.query.nome || 'Maria';

  const fn = MENSAGENS[tipo] || MENSAGENS.abandonado;
  const mensagem = fn(nome);

  res.json({
    tipo,
    nome,
    mensagem
  });
});

app.post('/teste-resposta', async (req, res) => {
  const { userId = 'teste', mensagem } = req.body;
  if (!mensagem) return res.status(400).json({ erro: 'mande a mensagem no body' });

  const reply = await askGrok(userId, mensagem);
  res.json({ userId, sua_mensagem: mensagem, resposta_thais: reply });
});

async function askGrok(userId, userMessage) {
  const history = conversations.get(userId) || [];
  history.push({ role: 'user', content: userMessage });

  try {
    const response = await axios.post(
      'https://api.x.ai/v1/chat/completions',
      {
        model: 'grok-3',
        messages: [
          {
            role: 'system',
            content: `Você é a Thais, da equipe da Suellen. Atua no WhatsApp recuperando vendas que não foram concluídas (carrinho abandonado, erro no cartão, PIX não pago, reembolso) e conduzindo a pessoa até a compra quando fizer sentido.

Você fala como alguém da equipe, próxima e humana. Tom direto e natural, sem ser grosseira e sem parecer robô.

## Regras de formato
- Mensagens curtas (máximo 2-3 linhas).
- Uma ideia por mensagem.
- Quebre com linha em branco se precisar falar mais.
- Uma pergunta por vez.
- Não use travessão (—).
- Sem markdown.
- Sem aberturas genéricas.

## Como conduzir
- Sempre leia o que a pessoa já falou antes de responder. Não repita pergunta que ela já respondeu.
- Se ela já explicou o problema (erro no cartão, falta de limite, dúvida, etc.), não pergunte de novo. Avance para a solução.
- Quando a pessoa pedir o link, disser que perdeu, ou quiser finalizar, mande o link na hora. Não peça e-mail só para isso.
- Ofereça PIX como alternativa quando o cartão der erro.

## Links (use quando fizer sentido)
- Checkout direto: https://pay.hub.la/I4mj0BRRyCfFk2l2mRl8
- Página de vendas (só se ela ainda tiver dúvida grande): https://www.maquinadevendasporwhatsapp.com.br/

## Regras importantes
- Nunca chame para ligação.
- Nunca invente preço, bônus ou promessa.
- Não fique pedindo e-mail sem necessidade.
- Se não souber algo, diga que vai verificar com a equipe da Suellen.
- Se a pessoa já comprou ou o reembolso já foi processado, não force venda.
- Responda curto e direto. Não repita informação já dita na conversa.`
          },
          ...history.slice(-6)
        ],
        max_tokens: 300
      },
      {
        headers: {
          Authorization: `Bearer ${GROK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = response.data.choices[0].message.content;
    history.push({ role: 'assistant', content: reply });
    conversations.set(userId, history);
    return reply;
  } catch (err) {
    console.error('Erro Grok:', err.response?.data || err.message);
    return 'Desculpe, tive um problema. Pode repetir?';
  }
}

async function sendWhatsApp(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log(`Mensagem enviada para ${to}`);
  } catch (err) {
    console.error('Erro WhatsApp:', err.response?.data || err.message);
  }
}

app.get('/', (req, res) => {
  res.send('Agente de Recuperação rodando!');
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
