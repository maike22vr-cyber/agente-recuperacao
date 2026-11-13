require('dotenv').config();
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

// Armazena conversas simples em memória (para produção use um banco)
const conversations = new Map();

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

      // Responde com Grok
      const reply = await askGrok(from, text);
      await sendWhatsApp(from, reply);
    }
  }

  res.sendStatus(200);
});

// Webhook da Hubla (carrinho abandonado, pagamento falhou etc.)
app.post('/hubla', async (req, res) => {
  const event = req.body;
  console.log('Evento Hubla:', event.type || event.event);

  // Exemplo simples: se for carrinho abandonado
  if (event.type === 'lead.abandoned_checkout' || event.event?.type === 'lead.abandoned_checkout') {
    const phone = event.event?.lead?.phone || event.lead?.phone;
    const name = event.event?.lead?.fullName || event.lead?.fullName || 'Cliente';

    if (phone) {
      // Delay de 5 minutos
      setTimeout(async () => {
        const message = `Oi ${name}! Vi que você começou a compra mas não finalizou. Posso te ajudar a concluir?`;
        await sendWhatsApp(phone.replace(/\D/g, ''), message);
      }, 5 * 60 * 1000);
    }
  }

  res.sendStatus(200);
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
            content: `Você é um assistente de recuperação de vendas. Seja educado, objetivo e ajude o cliente a finalizar a compra ou resolver dúvidas sobre pagamento/reembolso. Responda em português.`
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
